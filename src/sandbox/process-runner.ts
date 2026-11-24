/**
 * Hardened OS Process Runner (`shell: false`, Windows `PATHEXT` resolution,
 * case-insensitive credential env scrubbing, and process-tree teardown).
 */

import {spawn} from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import {findBlockedCommandViolation} from '../core/policy.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  ISandboxProcessRunner,
  ProcessRunOptions,
  ProcessRunResult,
} from './contracts.ts';

const SENSITIVE_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
const DEFAULT_TIMEOUT_MS = 120_000;

function isExecutableFile(filePath: string): boolean {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) {
      return false;
    }
    if (process.platform !== 'win32') {
      accessSync(filePath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

interface UnwrappedWindowsCmdTarget {
  readonly kind: 'node' | 'exe';
  readonly targetPath: string;
}

function isPosixShebangFile(filePath: string): boolean {
  try {
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.allocUnsafe(2);
      const n = readSync(fd, buf, 0, 2, 0);
      return n === 2 && buf[0] === 0x23 && buf[1] === 0x21;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function unwrapWindowsNpmCmdTarget(
  cmdPath: string,
): UnwrappedWindowsCmdTarget | null {
  try {
    const content = readFileSync(cmdPath, 'utf8');
    const jsMatch =
      /"%(?:dp0|~dp0)%[\\/]([^"\r\n]+?\.(?:c?m?js))"/i.exec(content) ??
      /"%~dp0([^"\r\n]+?\.(?:c?m?js))"/i.exec(content);
    if (jsMatch?.[1]) {
      const relTarget = jsMatch[1].replace(/^[/\\]+/, '');
      const candidate = resolve(dirname(cmdPath), relTarget);
      if (existsSync(candidate)) {
        return {kind: 'node', targetPath: candidate};
      }
    }

    const exeMatch =
      /"%(?:dp0|~dp0)%[\\/]([^"\r\n]+?\.exe)"/i.exec(content) ??
      /"%~dp0([^"\r\n]+?\.exe)"/i.exec(content);
    if (exeMatch?.[1]) {
      const relTarget = exeMatch[1].replace(/^[/\\]+/, '');
      if (relTarget.toLowerCase() !== 'node.exe') {
        const candidate = resolve(dirname(cmdPath), relTarget);
        if (existsSync(candidate)) {
          return {kind: 'exe', targetPath: candidate};
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function getWindowsPathExts(): string[] {
  const raw = process.env['PATHEXT'] ?? '.EXE;.COM;.CMD;.BAT';
  const fromEnv = raw
    .split(';')
    .map(e => e.trim().toLowerCase())
    .filter(e => e.startsWith('.') && e !== '.ps1');
  const preferred = ['.exe', '.com', '.cmd', '.bat'];
  const ordered: string[] = [];
  for (const ext of preferred) {
    if (!ordered.includes(ext)) {
      ordered.push(ext);
    }
  }
  for (const ext of fromEnv) {
    if (!ordered.includes(ext)) {
      ordered.push(ext);
    }
  }
  return ordered;
}

export function buildScrubbedEnvironment(
  envAllowlist: readonly string[] = [],
  extraEnv: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const allowSet = new Set(envAllowlist.map(k => k.toUpperCase()));
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') {
      continue;
    }
    if (SENSITIVE_ENV_PATTERN.test(key) && !allowSet.has(key.toUpperCase())) {
      continue;
    }
    env[key] = value;
  }

  if (!env['GIT_TERMINAL_PROMPT']) {
    env['GIT_TERMINAL_PROMPT'] = '0';
  }

  for (const [key, value] of Object.entries(extraEnv)) {
    env[key] = value;
  }

  return env;
}

export function splitChainedCommands(commandLine: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < commandLine.length; i += 1) {
    const ch = commandLine[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < commandLine.length) {
        current += ch + commandLine[i + 1]!;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '&' && commandLine[i + 1] === '&') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = '';
      i += 1;
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    segments.push(tail);
  }
  return segments;
}

export function tokenizeCommandArgv(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        const next = segment[i + 1]!;
        if (next === '"' || next === '\\') {
          current += next;
          i += 1;
          continue;
        }
      }
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }

    inToken = true;
    current += ch;
  }

  if (quote !== null) {
    throw new ForgeError(
      'VALIDATION_ERROR',
      `Unterminated quote in command segment: ${segment}`,
      400,
    );
  }

  if (inToken) {
    tokens.push(current);
  }
  return tokens;
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid || pid <= 0) {
    return;
  }
  if (process.platform === 'win32') {
    await new Promise<void>(resolveKill => {
      let done = false;
      const finishKill = (): void => {
        if (!done) {
          done = true;
          resolveKill();
        }
      };
      const guard = setTimeout(finishKill, 1500);
      try {
        const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('close', () => {
          clearTimeout(guard);
          finishKill();
        });
        killer.once('error', () => {
          clearTimeout(guard);
          finishKill();
        });
      } catch {
        clearTimeout(guard);
        finishKill();
      }
    });
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}

function quoteCmdToken(token: string): string {
  return /[\s"]/u.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token;
}

export interface InteractiveProcessControls {
  writeStdin(text: string): void;
  endStdin(): void;
  terminate(): void;
}

export interface InteractiveProcessRunOptions extends ProcessRunOptions {
  readonly keepStdinOpen?: boolean;
  readonly onInteractiveStdoutLine?: (
    line: string,
    controls: InteractiveProcessControls,
  ) => void;
}

export class SandboxProcessRunner implements ISandboxProcessRunner {
  resolveExecutable(command: string): string | null {
    const trimmed = command.trim();
    if (!trimmed || /[\0\r\n]/.test(trimmed)) {
      return null;
    }

    const isWin = process.platform === 'win32';
    const winExts = isWin ? getWindowsPathExts() : [];
    const hasPathSep =
      isAbsolute(trimmed) ||
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      trimmed.startsWith('.');

    const probeCandidate = (basePath: string): string | null => {
      if (isWin) {
        const ext = extname(basePath).toLowerCase();
        if (ext && winExts.includes(ext) && isExecutableFile(basePath)) {
          return basePath;
        }
        for (const pathext of winExts) {
          const withExt = `${basePath}${pathext}`;
          if (isExecutableFile(withExt)) {
            return withExt;
          }
        }
        if (isExecutableFile(basePath) && !isPosixShebangFile(basePath)) {
          return basePath;
        }
        return null;
      }
      if (isExecutableFile(basePath)) {
        return basePath;
      }
      return null;
    };

    if (hasPathSep) {
      return probeCandidate(resolve(trimmed));
    }

    const pathEnv =
      process.env['PATH'] ?? process.env['Path'] ?? process.env['path'] ?? '';
    const dirs = pathEnv
      .split(delimiter)
      .map(d => d.trim())
      .filter(Boolean);

    for (const dir of dirs) {
      const candidate = join(dir, trimmed);
      const hit = probeCandidate(candidate);
      if (hit) {
        return hit;
      }
    }

    return null;
  }

  async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    return this.runInteractive(options);
  }

  async runInteractive(
    options: InteractiveProcessRunOptions,
  ): Promise<ProcessRunResult> {
    const fullArgv = [options.executable, ...options.args];
    const violation = findBlockedCommandViolation(
      fullArgv,
      options.blockedCommandPatterns ?? [],
    );
    if (violation) {
      throw new ForgeError(
        'POLICY_DENIED',
        `POLICY_BLOCKED: ${violation}`,
        403,
      );
    }

    for (const token of fullArgv) {
      if (token.includes('\0')) {
        throw new ForgeError(
          'POLICY_DENIED',
          'POLICY_BLOCKED: Null byte detected in process argv',
          403,
        );
      }
    }

    const startedAt = Date.now();
    if (options.signal?.aborted) {
      return {
        exitCode: 124,
        stdout: '',
        stderr: 'Aborted before process spawn',
        timedOut: true,
        durationMs: 1,
      };
    }

    const resolved = this.resolveExecutable(options.executable);
    if (!resolved) {
      return {
        exitCode: 127,
        stdout: '',
        stderr: `Executable not found: ${options.executable}`,
        timedOut: false,
        durationMs: Math.max(1, Date.now() - startedAt),
      };
    }

    let spawnFile = resolved;
    let spawnArgs: string[] = [...options.args];
    let windowsVerbatimArguments = false;

    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
      const unwrapped = unwrapWindowsNpmCmdTarget(resolved);
      if (unwrapped?.kind === 'node') {
        spawnFile = process.execPath;
        spawnArgs = [unwrapped.targetPath, ...options.args];
      } else if (unwrapped?.kind === 'exe') {
        spawnFile = unwrapped.targetPath;
        spawnArgs = [...options.args];
      } else {
        for (const part of [resolved, ...options.args]) {
          if (/[&|<>^%!\r\n\0]/.test(part)) {
            throw new ForgeError(
              'POLICY_DENIED',
              'POLICY_BLOCKED: Shell metacharacters rejected in batch invocation',
              403,
            );
          }
        }
        spawnFile = process.env['ComSpec'] || 'cmd.exe';
        const needsOuterQuotes = [resolved, ...options.args].some(t =>
          /[\s"]/u.test(t),
        );
        if (needsOuterQuotes) {
          const cmdLine = `"${[resolved, ...options.args].map(quoteCmdToken).join(' ')}"`;
          spawnArgs = ['/d', '/s', '/c', cmdLine];
          windowsVerbatimArguments = true;
        } else {
          spawnArgs = ['/d', '/s', '/c', resolved, ...options.args];
        }
      }
    }

    const env = buildScrubbedEnvironment(
      options.envAllowlist,
      options.extraEnv,
    );
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<ProcessRunResult>(resolvePromise => {
      let stdout = '';
      let stderr = '';
      let stdoutRemainder = '';
      let stderrRemainder = '';
      let timedOut = false;
      let settled = false;
      let killRequested = false;

      const child = spawn(spawnFile, spawnArgs, {
        cwd: options.cwd,
        env,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        windowsVerbatimArguments,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const triggerTreeKill = (): void => {
        if (killRequested) {
          return;
        }
        killRequested = true;
        void killProcessTree(child.pid);
      };

      const controls: InteractiveProcessControls = {
        writeStdin: (text: string) => {
          if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
            child.stdin.write(text, 'utf8');
          }
        },
        endStdin: () => {
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.end();
          }
        },
        terminate: () => {
          triggerTreeKill();
        },
      };

      const timer = setTimeout(() => {
        timedOut = true;
        triggerTreeKill();
      }, timeoutMs);

      const onAbort = (): void => {
        timedOut = true;
        triggerTreeKill();
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener('abort', onAbort, {once: true});
        }
      }

      const emitStdoutLine = (line: string): void => {
        options.onStdoutLine?.(line);
        options.onInteractiveStdoutLine?.(line, controls);
      };

      const finish = (exitCode: number, extraStderr = ''): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        if (stdoutRemainder) {
          emitStdoutLine(stdoutRemainder);
          stdoutRemainder = '';
        }
        if (stderrRemainder && options.onStderrLine) {
          options.onStderrLine(stderrRemainder);
          stderrRemainder = '';
        }
        if (extraStderr) {
          stderr = stderr ? `${stderr}\n${extraStderr}` : extraStderr;
        }
        resolvePromise({
          exitCode,
          stdout,
          stderr,
          timedOut,
          durationMs: Math.max(1, Date.now() - startedAt),
        });
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        if (options.onStdoutLine || options.onInteractiveStdoutLine) {
          stdoutRemainder += text;
          const lines = stdoutRemainder.split(/\r?\n/);
          stdoutRemainder = lines.pop() ?? '';
          for (const line of lines) {
            emitStdoutLine(line);
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr += text;
        if (options.onStderrLine) {
          stderrRemainder += text;
          const lines = stderrRemainder.split(/\r?\n/);
          stderrRemainder = lines.pop() ?? '';
          for (const line of lines) {
            options.onStderrLine(line);
          }
        }
      });

      child.on('error', (err: Error) => {
        finish(127, err.message);
      });

      child.on('close', (code: number | null) => {
        finish(timedOut ? 124 : (code ?? 1));
      });

      if (child.stdin) {
        child.stdin.on('error', () => {
          // Ignore EPIPE when child exits before consuming stdin.
        });
        if (options.stdinText !== undefined) {
          child.stdin.write(options.stdinText, 'utf8');
        }
        if (!options.keepStdinOpen) {
          child.stdin.end();
        }
      }
    });
  }

  async runCommandString(
    commandLine: string,
    cwd: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    blockedPatterns: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<ProcessRunResult> {
    const rawViolation = findBlockedCommandViolation(
      [commandLine],
      blockedPatterns,
    );
    if (rawViolation) {
      throw new ForgeError(
        'POLICY_DENIED',
        `POLICY_BLOCKED: ${rawViolation}`,
        403,
      );
    }

    const segments = splitChainedCommands(commandLine);
    if (segments.length === 0) {
      throw new ForgeError('VALIDATION_ERROR', 'Empty commandLine', 400);
    }

    const startedAt = Date.now();
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];

    for (const seg of segments) {
      const tokens = tokenizeCommandArgv(seg);
      if (tokens.length === 0) {
        continue;
      }
      const [executable, ...args] = tokens;
      const elapsed = Date.now() - startedAt;
      const remainingTimeout = Math.max(500, timeoutMs - elapsed);

      const res = await this.run({
        executable: executable!,
        args,
        cwd,
        timeoutMs: remainingTimeout,
        blockedCommandPatterns: blockedPatterns,
        signal,
      });

      if (res.stdout) {
        stdoutParts.push(res.stdout);
      }
      if (res.stderr) {
        stderrParts.push(res.stderr);
      }

      if (res.exitCode !== 0 || res.timedOut) {
        return {
          exitCode: res.exitCode,
          stdout: stdoutParts.join('\n'),
          stderr: stderrParts.join('\n'),
          timedOut: res.timedOut,
          durationMs: Math.max(1, Date.now() - startedAt),
        };
      }
    }

    return {
      exitCode: 0,
      stdout: stdoutParts.join('\n'),
      stderr: stderrParts.join('\n'),
      timedOut: false,
      durationMs: Math.max(1, Date.now() - startedAt),
    };
  }
}
