import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {isFileInsideScope} from '../core/glob-scope.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  CheckpointCommitResult,
  IGitWorktreeManager,
  ISandboxProcessRunner,
  ProcessRunResult,
  RepoMergeReadinessResult,
  RewindWorktreeResult,
  WorktreeDiffSummary,
  WorktreeHandle,
} from './contracts.ts';
import {WorktreeLockManager} from './worktree-lock.ts';

const WIN_RESERVED_DEVICE =
  /^(CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function stripWinVerbatimPrefix(p: string): string {
  return p.startsWith('\\\\?\\') ? p.slice(4) : p;
}

function tryLstat(targetPath: string): Stats | null {
  try {
    return lstatSync(targetPath);
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as {code?: unknown}).code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }
}

function canonicalizeWithExistingAncestors(targetPath: string): string {
  const abs = stripWinVerbatimPrefix(resolve(targetPath));
  const tailSegments: string[] = [];
  let cursor = abs;

  while (true) {
    const st = tryLstat(cursor);
    if (st !== null) {
      if (st.isSymbolicLink()) {
        try {
          const resolvedLink = stripWinVerbatimPrefix(
            realpathSync.native(cursor),
          );
          return tailSegments.length > 0
            ? stripWinVerbatimPrefix(resolve(resolvedLink, ...tailSegments))
            : resolvedLink;
        } catch {
          throw new ForgeError(
            'FORBIDDEN_PATH',
            `SANDBOX_ESCAPE: Dangling or unresolvable symlink "${cursor}" is forbidden`,
            403,
          );
        }
      }
      break;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    const base = cursor.slice(parent.length).replace(/^[/\\]+/, '');
    tailSegments.unshift(base);
    cursor = parent;
  }

  let resolvedBase = cursor;
  if (tryLstat(cursor) !== null) {
    try {
      resolvedBase = stripWinVerbatimPrefix(realpathSync.native(cursor));
    } catch (err) {
      throw new ForgeError(
        'FORBIDDEN_PATH',
        `SANDBOX_ESCAPE: Unresolvable path "${cursor}": ${err instanceof Error ? err.message : String(err)}`,
        403,
      );
    }
  }

  return tailSegments.length > 0
    ? stripWinVerbatimPrefix(resolve(resolvedBase, ...tailSegments))
    : resolvedBase;
}

function sanitizeRefSegment(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  );
}

function countFileLinesStreamed(filePath: string): {
  readonly isBinary: boolean;
  readonly lineCount: number;
} {
  const chunkSize = 65_536;
  const buf = Buffer.allocUnsafe(chunkSize);
  const fd = openSync(filePath, 'r');
  try {
    let totalBytesRead = 0;
    let newlines = 0;
    let lastByte = -1;
    while (true) {
      const n = readSync(fd, buf, 0, chunkSize, null);
      if (n <= 0) {
        break;
      }
      if (totalBytesRead < 8192) {
        const probeEnd = Math.min(n, 8192 - totalBytesRead);
        for (let i = 0; i < probeEnd; i += 1) {
          if (buf[i] === 0) {
            return {isBinary: true, lineCount: 0};
          }
        }
      }
      for (let i = 0; i < n; i += 1) {
        if (buf[i] === 10) {
          newlines += 1;
        }
      }
      lastByte = buf[n - 1]!;
      totalBytesRead += n;
    }
    if (totalBytesRead === 0) {
      return {isBinary: false, lineCount: 0};
    }
    return {
      isBinary: false,
      lineCount: lastByte === 10 ? newlines : newlines + 1,
    };
  } finally {
    closeSync(fd);
  }
}

function buildUntrackedUnifiedDiff(
  worktreePath: string,
  relPaths: readonly string[],
): {readonly patch: string; readonly addedLines: number} {
  const blocks: string[] = [];
  let addedLines = 0;
  let totalBytes = 0;

  for (const rel of relPaths) {
    const full = join(worktreePath, rel);
    try {
      const st = statSync(full);
      if (!st.isFile()) {
        continue;
      }
      const canIncludePatch =
        blocks.length < 100 && totalBytes < 256_000 && st.size <= 131_072;
      if (!canIncludePatch) {
        const counted = countFileLinesStreamed(full);
        if (!counted.isBinary) {
          addedLines += counted.lineCount;
        }
        continue;
      }

      const buf = readFileSync(full);
      const probeLen = Math.min(buf.length, 8192);
      let isBinary = false;
      for (let i = 0; i < probeLen; i += 1) {
        if (buf[i] === 0) {
          isBinary = true;
          break;
        }
      }
      if (isBinary) {
        continue;
      }
      const text = buf.toString('utf8');
      const rawLines = text.split(/\r?\n/);
      if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
        rawLines.pop();
      }
      addedLines += rawLines.length;
      const cleanRel = rel.replace(/\\/g, '/');
      const header = [
        `diff --git a/${cleanRel} b/${cleanRel}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${cleanRel}`,
        `@@ -0,0 +1,${Math.max(1, rawLines.length)} @@`,
      ];
      const body = rawLines.map(line => `+${line}`);
      const block = [...header, ...body].join('\n');
      const blockBytes = Buffer.byteLength(block, 'utf8');
      if (totalBytes + blockBytes <= 256_000) {
        totalBytes += blockBytes;
        blocks.push(block);
      }
    } catch {
      // Ignore unreadable transient files.
    }
  }

  return {patch: blocks.join('\n'), addedLines};
}

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 32) {
      return true;
    }
  }
  return false;
}

export class GitWorktreeManager implements IGitWorktreeManager {
  private readonly runner: ISandboxProcessRunner;
  readonly locks: WorktreeLockManager;

  constructor(
    runner: ISandboxProcessRunner,
    locks = new WorktreeLockManager(),
  ) {
    this.runner = runner;
    this.locks = locks;
  }

  private runGit(
    cwd: string,
    args: readonly string[],
    timeoutMs?: number,
  ): Promise<ProcessRunResult> {
    return this.runner.run({
      executable: 'git',
      args,
      cwd,
      extraEnv: {LC_ALL: 'C'},
      timeoutMs,
    });
  }

  resolveInside(
    rootDir: string,
    candidatePath: string,
    opts?: {readonly allowDotGit?: boolean},
  ): string {
    if (
      rootDir.includes('\0') ||
      candidatePath.includes('\0') ||
      hasControlChar(candidatePath)
    ) {
      throw new ForgeError(
        'FORBIDDEN_PATH',
        'SANDBOX_ESCAPE: Control character in path is forbidden',
        403,
      );
    }

    if (
      /^[A-Za-z]:(?![/\\])/.test(candidatePath) ||
      /^(?:\\\\|\/\/)[.?](?:\\|\/)/.test(candidatePath) ||
      /^\\\\\?\\UNC\\/i.test(candidatePath)
    ) {
      throw new ForgeError(
        'FORBIDDEN_PATH',
        `SANDBOX_ESCAPE: Unsafe Windows drive-relative or device path "${candidatePath}" is forbidden`,
        403,
      );
    }

    const canonicalRoot = canonicalizeWithExistingAncestors(rootDir);
    const joinedCandidate = isAbsolute(candidatePath)
      ? stripWinVerbatimPrefix(resolve(candidatePath))
      : stripWinVerbatimPrefix(resolve(canonicalRoot, candidatePath));
    const canonicalTarget = canonicalizeWithExistingAncestors(joinedCandidate);

    const rel = relative(canonicalRoot, canonicalTarget);
    const escapes =
      rel === '..' ||
      rel.startsWith('../') ||
      rel.startsWith('..\\') ||
      isAbsolute(rel) ||
      (process.platform === 'win32' &&
        canonicalRoot[0]?.toLowerCase() !== canonicalTarget[0]?.toLowerCase());

    if (escapes) {
      throw new ForgeError(
        'FORBIDDEN_PATH',
        `SANDBOX_ESCAPE: Candidate path "${candidatePath}" escapes root "${rootDir}"`,
        403,
      );
    }

    if (rel) {
      const segments = rel.split(/[/\\]+/).filter(Boolean);
      for (const seg of segments) {
        if (seg.includes(':')) {
          throw new ForgeError(
            'FORBIDDEN_PATH',
            `SANDBOX_ESCAPE: Alternate data stream or colon forbidden in "${seg}"`,
            403,
          );
        }
        const stripped = seg.replace(/[. ]+$/, '');
        if (!opts?.allowDotGit && stripped.toLowerCase() === '.git') {
          throw new ForgeError(
            'FORBIDDEN_PATH',
            'SANDBOX_ESCAPE: Access to .git metadata is forbidden',
            403,
          );
        }
        if (
          process.platform === 'win32' &&
          WIN_RESERVED_DEVICE.test(stripped)
        ) {
          throw new ForgeError(
            'FORBIDDEN_PATH',
            `SANDBOX_ESCAPE: Windows reserved device name "${seg}" is forbidden`,
            403,
          );
        }
      }
    }

    return canonicalTarget;
  }

  async ensureGitRepoInitialized(
    repoPath: string,
    defaultBranch = 'main',
  ): Promise<string> {
    mkdirSync(repoPath, {recursive: true});
    return this.locks.withRepoLock(repoPath, this.runner, async () => {
      const headCheck = await this.runGit(repoPath, [
        'rev-parse',
        '--verify',
        'HEAD',
      ]);

      if (headCheck.exitCode === 0 && headCheck.stdout.trim().length > 0) {
        return headCheck.stdout.trim();
      }

      const gitDirCheck = await this.runGit(repoPath, [
        'rev-parse',
        '--is-inside-work-tree',
      ]);

      if (gitDirCheck.exitCode !== 0) {
        const initRes = await this.runGit(repoPath, [
          'init',
          '-b',
          defaultBranch,
        ]);
        if (initRes.exitCode !== 0) {
          await this.runGit(repoPath, ['init']);
          await this.runGit(repoPath, ['checkout', '-B', defaultBranch]);
        }
      }

      const entries = readdirSync(repoPath).filter(name => name !== '.git');
      if (entries.length === 0) {
        writeFileSync(
          join(repoPath, '.gitkeep'),
          '# ForgeOps repository\n',
          'utf8',
        );
      }

      await this.runGit(repoPath, ['add', '-A']);

      const commitRes = await this.runGit(repoPath, [
        '-c',
        'user.name=ForgeOps',
        '-c',
        'user.email=forgeops@local',
        'commit',
        '--allow-empty',
        '-m',
        'chore: initialize repository',
      ]);

      if (commitRes.exitCode !== 0) {
        throw new ForgeError(
          'INTERNAL_ERROR',
          `Failed to create initial commit in ${repoPath}: ${commitRes.stderr}`,
          500,
        );
      }

      const shaRes = await this.runGit(repoPath, ['rev-parse', 'HEAD']);
      return shaRes.stdout.trim();
    });
  }

  async provisionWorktree(input: {
    readonly repoPath: string;
    readonly worktreesRoot: string;
    readonly repoId: string;
    readonly changeCode: string;
    readonly changeId?: string;
    readonly baseRef?: string;
  }): Promise<WorktreeHandle> {
    const defaultHead = await this.ensureGitRepoInitialized(input.repoPath);
    mkdirSync(input.worktreesRoot, {recursive: true});

    return this.locks.withRepoLock(input.repoPath, this.runner, async () => {
      const cleanChange = sanitizeRefSegment(input.changeCode);
      const cleanRepo = sanitizeRefSegment(input.repoId);
      const idSuffix = input.changeId
        ? `-${sanitizeRefSegment(input.changeId).slice(-6)}`
        : '';
      const dirName = `${cleanRepo}-${cleanChange}${idSuffix}`;
      const worktreePath = this.resolveInside(input.worktreesRoot, dirName);
      const branchName = `forgeops/${cleanChange}${idSuffix}`;

      await this.runGit(input.repoPath, ['worktree', 'prune']);

      if (existsSync(worktreePath)) {
        if (input.changeId) {
          throw new ForgeError(
            'CONFLICT',
            `Worktree path "${worktreePath}" already exists for active Change`,
            409,
          );
        }
        await this.runGit(input.repoPath, [
          'worktree',
          'remove',
          '--force',
          worktreePath,
        ]);
        rmSync(worktreePath, {recursive: true, force: true});
      }

      let baseCommitSha = defaultHead;
      if (input.baseRef) {
        const refRes = await this.runGit(input.repoPath, [
          'rev-parse',
          '--verify',
          input.baseRef,
        ]);
        if (refRes.exitCode === 0 && refRes.stdout.trim().length > 0) {
          baseCommitSha = refRes.stdout.trim();
        }
      }

      const addRes = await this.runGit(input.repoPath, [
        'worktree',
        'add',
        '--force',
        '-B',
        branchName,
        worktreePath,
        baseCommitSha,
      ]);

      if (addRes.exitCode !== 0) {
        throw new ForgeError(
          'INTERNAL_ERROR',
          `git worktree add failed: ${addRes.stderr || addRes.stdout}`,
          500,
        );
      }

      return {
        repoId: input.repoId,
        changeCode: input.changeCode,
        worktreePath,
        branchName,
        baseCommitSha,
      };
    });
  }

  async createCheckpoint(input: {
    readonly worktreePath: string;
    readonly changeCode: string;
    readonly nodeCode: string;
    readonly message: string;
  }): Promise<CheckpointCommitResult> {
    return this.locks.withRepoLock(
      input.worktreePath,
      this.runner,
      async () => {
        await this.runGit(input.worktreePath, ['add', '-A']);

        const diffCached = await this.runGit(input.worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          '--cached',
          '--name-only',
          '-z',
        ]);
        const changedFiles = diffCached.stdout.split('\0').filter(Boolean);

        const commitRes = await this.runGit(input.worktreePath, [
          '-c',
          'user.name=ForgeOps',
          '-c',
          'user.email=forgeops@local',
          'commit',
          '--allow-empty',
          '-m',
          input.message,
        ]);

        if (commitRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `Checkpoint commit failed: ${commitRes.stderr || commitRes.stdout}`,
            500,
          );
        }

        const revRes = await this.runGit(input.worktreePath, [
          'rev-parse',
          'HEAD',
        ]);
        const commitSha = revRes.stdout.trim();
        const shortSha = commitSha.slice(0, 8);
        const cleanChange = sanitizeRefSegment(input.changeCode);
        const cleanNode = sanitizeRefSegment(input.nodeCode);
        const gitTag = `forgeops/${cleanChange}/${cleanNode}-${shortSha}`;

        await this.runGit(input.worktreePath, ['tag', '-f', gitTag, commitSha]);

        return {
          commitSha,
          gitTag,
          changedFiles,
        };
      },
    );
  }

  async rewindToCheckpoint(input: {
    readonly worktreePath: string;
    readonly changeCode: string;
    readonly targetCommitSha: string;
  }): Promise<RewindWorktreeResult> {
    return this.locks.withRepoLock(
      input.worktreePath,
      this.runner,
      async () => {
        const cleanChange = sanitizeRefSegment(input.changeCode);
        const rescueRef = `refs/forgeops-backup/${cleanChange}/${Date.now()}`;

        const refRes = await this.runGit(input.worktreePath, [
          'update-ref',
          rescueRef,
          'HEAD',
        ]);
        if (refRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `Failed to create rescue ref "${rescueRef}": ${refRes.stderr}`,
            500,
          );
        }

        const resetRes = await this.runGit(input.worktreePath, [
          'reset',
          '--hard',
          input.targetCommitSha,
        ]);
        if (resetRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `Failed to rewind worktree to "${input.targetCommitSha}": ${resetRes.stderr}`,
            500,
          );
        }

        await this.runGit(input.worktreePath, ['clean', '-fd']);

        const headRes = await this.runGit(input.worktreePath, [
          'rev-parse',
          'HEAD',
        ]);

        return {
          restoredCommitSha: headRes.stdout.trim() || input.targetCommitSha,
          rescueRef,
        };
      },
    );
  }

  async revertTaskScope(
    worktreePath: string,
    fileScope: readonly string[],
  ): Promise<void> {
    if (!existsSync(worktreePath)) {
      return;
    }
    await this.locks.withRepoLock(worktreePath, this.runner, async () => {
      if (fileScope.length === 0) {
        await this.runGit(worktreePath, ['reset', '--hard', 'HEAD']);
        await this.runGit(worktreePath, ['clean', '-fd']);
        return;
      }

      const [trackedRes, untrackedRes] = await Promise.all([
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          '--name-only',
          '-z',
          'HEAD',
        ]),
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
        ]),
      ]);

      if (trackedRes.exitCode !== 0 || untrackedRes.exitCode !== 0) {
        throw new ForgeError(
          'INTERNAL_ERROR',
          `Failed to inspect worktree before revertTaskScope: ${trackedRes.stderr || untrackedRes.stderr}`,
          500,
        );
      }

      const trackedMatches = trackedRes.stdout
        .split('\0')
        .filter(f => f && isFileInsideScope(f, fileScope));
      if (trackedMatches.length > 0) {
        const checkoutRes = await this.runGit(worktreePath, [
          'checkout',
          'HEAD',
          '--',
          ...trackedMatches,
        ]);
        if (checkoutRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `git checkout failed during revertTaskScope: ${checkoutRes.stderr}`,
            500,
          );
        }
      }

      const untrackedMatches = untrackedRes.stdout
        .split('\0')
        .filter(f => f && isFileInsideScope(f, fileScope));
      for (const rel of untrackedMatches) {
        const safe = this.resolveInside(worktreePath, rel);
        rmSync(safe, {recursive: true, force: true});
      }
    });
  }

  async snapshotWorkingTree(worktreePath: string): Promise<readonly string[]> {
    if (!existsSync(worktreePath)) {
      return [];
    }
    const [trackedRes, untrackedRes] = await Promise.all([
      this.runGit(worktreePath, [
        '-c',
        'core.quotePath=false',
        'diff',
        '--name-only',
        '-z',
        'HEAD',
      ]),
      this.runGit(worktreePath, [
        '-c',
        'core.quotePath=false',
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
      ]),
    ]);
    if (trackedRes.exitCode !== 0 || untrackedRes.exitCode !== 0) {
      throw new ForgeError(
        'INTERNAL_ERROR',
        `snapshotWorkingTree failed: ${trackedRes.stderr || untrackedRes.stderr}`,
        500,
      );
    }
    return Array.from(
      new Set([
        ...trackedRes.stdout.split('\0').filter(Boolean),
        ...untrackedRes.stdout.split('\0').filter(Boolean),
      ]),
    );
  }

  async revertFiles(
    worktreePath: string,
    files: readonly string[],
  ): Promise<void> {
    if (!existsSync(worktreePath) || files.length === 0) {
      return;
    }
    await this.locks.withRepoLock(worktreePath, this.runner, async () => {
      const [trackedRes, stagedAddedRes, untrackedRes] = await Promise.all([
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          '--name-only',
          '-z',
          'HEAD',
        ]),
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          '--cached',
          '--name-only',
          '--diff-filter=A',
          '-z',
        ]),
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
        ]),
      ]);

      if (
        trackedRes.exitCode !== 0 ||
        stagedAddedRes.exitCode !== 0 ||
        untrackedRes.exitCode !== 0
      ) {
        throw new ForgeError(
          'INTERNAL_ERROR',
          `Failed to inspect worktree in revertFiles: ${trackedRes.stderr || stagedAddedRes.stderr || untrackedRes.stderr}`,
          500,
        );
      }

      const trackedChangedSet = new Set(
        trackedRes.stdout.split('\0').filter(Boolean),
      );
      const stagedAddedSet = new Set(
        stagedAddedRes.stdout.split('\0').filter(Boolean),
      );
      const untrackedList = untrackedRes.stdout.split('\0').filter(Boolean);
      const untrackedSet = new Set(untrackedList);

      const trackedToRevert: string[] = [];
      const stagedAddedToReset: string[] = [];
      const untrackedToDelete: string[] = [];

      const seen = new Set<string>();
      for (const rel of files) {
        if (!rel) {
          continue;
        }
        const safe = this.resolveInside(worktreePath, rel);
        const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!norm || seen.has(norm)) {
          continue;
        }
        seen.add(norm);

        const isUntracked =
          untrackedSet.has(norm) ||
          untrackedList.some(u => u.endsWith('/') && norm.startsWith(u));
        if (isUntracked) {
          untrackedToDelete.push(safe);
          continue;
        }
        if (stagedAddedSet.has(norm)) {
          stagedAddedToReset.push(norm);
          untrackedToDelete.push(safe);
          continue;
        }
        if (trackedChangedSet.has(norm)) {
          trackedToRevert.push(norm);
          continue;
        }
        const checkTracked = await this.runGit(worktreePath, [
          'ls-files',
          '--error-unmatch',
          '--',
          norm,
        ]);
        if (checkTracked.exitCode === 0) {
          trackedToRevert.push(norm);
        }
      }

      if (stagedAddedToReset.length > 0) {
        const resetRes = await this.runGit(worktreePath, [
          'reset',
          '-q',
          'HEAD',
          '--',
          ...stagedAddedToReset,
        ]);
        if (resetRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `git reset failed during revertFiles: ${resetRes.stderr}`,
            500,
          );
        }
      }

      if (trackedToRevert.length > 0) {
        const checkoutRes = await this.runGit(worktreePath, [
          'checkout',
          'HEAD',
          '--',
          ...trackedToRevert,
        ]);
        if (checkoutRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `git checkout failed during revertFiles: ${checkoutRes.stderr}`,
            500,
          );
        }
      }

      for (const safe of untrackedToDelete) {
        rmSync(safe, {recursive: true, force: true});
      }
    });
  }

  async diffSinceCommit(
    worktreePath: string,
    fromCommitSha: string,
  ): Promise<WorktreeDiffSummary> {
    const [statRes, numstatRes, patchRes, namesRes, untrackedRes] =
      await Promise.all([
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          '--stat',
          fromCommitSha,
        ]),
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          '--numstat',
          fromCommitSha,
        ]),
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          fromCommitSha,
        ]),
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'diff',
          '--name-only',
          '-z',
          fromCommitSha,
        ]),
        this.runGit(worktreePath, [
          '-c',
          'core.quotePath=false',
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
        ]),
      ]);

    const failed = [statRes, numstatRes, patchRes, namesRes, untrackedRes].find(
      r => r.exitCode !== 0 || r.timedOut,
    );
    if (failed) {
      throw new ForgeError(
        'INTERNAL_ERROR',
        `git diffSinceCommit failed (exit ${failed.exitCode}): ${failed.stderr || failed.stdout}`,
        500,
      );
    }

    const trackedFiles = namesRes.stdout.split('\0').filter(Boolean);
    const untrackedFiles = untrackedRes.stdout.split('\0').filter(Boolean);

    const changedFiles = Array.from(
      new Set([...trackedFiles, ...untrackedFiles]),
    );

    let linesAdded = 0;
    let linesDeleted = 0;
    for (const line of numstatRes.stdout.split(/\r?\n/)) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const add = Number.parseInt(parts[0] ?? '0', 10);
        const del = Number.parseInt(parts[1] ?? '0', 10);
        if (Number.isFinite(add)) {
          linesAdded += add;
        }
        if (Number.isFinite(del)) {
          linesDeleted += del;
        }
      }
    }

    const untrackedDiff = buildUntrackedUnifiedDiff(
      worktreePath,
      untrackedFiles,
    );
    linesAdded += untrackedDiff.addedLines;

    const patch = [patchRes.stdout.trimEnd(), untrackedDiff.patch]
      .filter(Boolean)
      .join('\n');

    return {
      summary:
        statRes.stdout.trim() || `${changedFiles.length} file(s) changed`,
      patch,
      changedFiles,
      linesAdded,
      linesDeleted,
    };
  }

  async checkMergeReadiness(
    repoPath: string,
    targetBranch: string,
    changeBranch: string,
  ): Promise<RepoMergeReadinessResult> {
    const res = await this.runGit(repoPath, [
      'merge-tree',
      '--write-tree',
      targetBranch,
      changeBranch,
    ]);
    if (res.exitCode === 0 && !res.timedOut) {
      return {
        clean: true,
        conflictFiles: [],
        diagnostic: `Clean merge-tree against ${targetBranch}`,
      };
    }
    const combined = `${res.stdout}\n${res.stderr}`;
    const conflictFiles = Array.from(
      new Set(
        combined
          .split(/\r?\n/)
          .filter(l => /CONFLICT/i.test(l))
          .map(l => {
            const m = /Merge conflict in\s+(.+)$/i.exec(l);
            return (m?.[1] ?? l).trim().slice(0, 200);
          })
          .filter(Boolean),
      ),
    );
    return {
      clean: false,
      conflictFiles,
      diagnostic:
        conflictFiles.length > 0
          ? `Merge conflicts detected against ${targetBranch}`
          : combined.trim().slice(0, 240) ||
            `git merge-tree failed with exit code ${res.exitCode}`,
    };
  }

  async cleanupOrphanWorktrees(repoPath: string): Promise<readonly string[]> {
    return this.locks.withRepoLock(repoPath, this.runner, async () => {
      const pruneRes = await this.runGit(repoPath, ['worktree', 'prune', '-v']);
      const combined = `${pruneRes.stdout}\n${pruneRes.stderr}`;
      return combined
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    });
  }
}
