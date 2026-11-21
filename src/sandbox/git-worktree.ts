import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {isFileInsideScope} from '../core/glob-scope.ts';
import {ForgeError} from '../shared/errors.ts';
import type {
  CheckpointCommitResult,
  IGitWorktreeManager,
  ISandboxProcessRunner,
  RepoMergeReadinessResult,
  RewindWorktreeResult,
  WorktreeDiffSummary,
  WorktreeHandle,
} from './contracts.ts';
import {WorktreeLockManager} from './worktree-lock.ts';

const WIN_RESERVED_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function stripWinVerbatimPrefix(p: string): string {
  return p.startsWith('\\\\?\\') ? p.slice(4) : p;
}

function canonicalizeWithExistingAncestors(targetPath: string): string {
  const abs = stripWinVerbatimPrefix(resolve(targetPath));
  const tailSegments: string[] = [];
  let cursor = abs;

  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    const base = cursor.slice(parent.length).replace(/^[/\\]+/, '');
    tailSegments.unshift(base);
    cursor = parent;
  }

  let resolvedBase = cursor;
  if (existsSync(cursor)) {
    try {
      resolvedBase = stripWinVerbatimPrefix(realpathSync.native(cursor));
    } catch {
      resolvedBase = stripWinVerbatimPrefix(resolve(cursor));
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

function buildUntrackedUnifiedDiff(
  worktreePath: string,
  relPaths: readonly string[],
): {readonly patch: string; readonly addedLines: number} {
  const blocks: string[] = [];
  let addedLines = 0;
  let totalBytes = 0;

  for (const rel of relPaths.slice(0, 100)) {
    if (totalBytes > 256_000) {
      break;
    }
    const full = join(worktreePath, rel);
    try {
      const st = statSync(full);
      if (!st.isFile() || st.size > 131_072) {
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
      totalBytes += block.length;
      blocks.push(block);
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

    const canonicalRoot = canonicalizeWithExistingAncestors(rootDir);
    const joinedCandidate = isAbsolute(candidatePath)
      ? stripWinVerbatimPrefix(resolve(candidatePath))
      : stripWinVerbatimPrefix(resolve(canonicalRoot, candidatePath));
    const canonicalTarget = canonicalizeWithExistingAncestors(joinedCandidate);

    const rel = relative(canonicalRoot, canonicalTarget);
    const escapes =
      rel.startsWith('..') ||
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
      const headCheck = await this.runner.run({
        executable: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: repoPath,
      });

      if (headCheck.exitCode === 0 && headCheck.stdout.trim().length > 0) {
        return headCheck.stdout.trim();
      }

      const gitDirCheck = await this.runner.run({
        executable: 'git',
        args: ['rev-parse', '--is-inside-work-tree'],
        cwd: repoPath,
      });

      if (gitDirCheck.exitCode !== 0) {
        const initRes = await this.runner.run({
          executable: 'git',
          args: ['init', '-b', defaultBranch],
          cwd: repoPath,
        });
        if (initRes.exitCode !== 0) {
          await this.runner.run({
            executable: 'git',
            args: ['init'],
            cwd: repoPath,
          });
          await this.runner.run({
            executable: 'git',
            args: ['checkout', '-B', defaultBranch],
            cwd: repoPath,
          });
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

      await this.runner.run({
        executable: 'git',
        args: ['add', '-A'],
        cwd: repoPath,
      });

      const commitRes = await this.runner.run({
        executable: 'git',
        args: [
          '-c',
          'user.name=ForgeOps',
          '-c',
          'user.email=forgeops@local',
          'commit',
          '--allow-empty',
          '-m',
          'chore: initialize repository',
        ],
        cwd: repoPath,
      });

      if (commitRes.exitCode !== 0) {
        throw new ForgeError(
          'INTERNAL_ERROR',
          `Failed to create initial commit in ${repoPath}: ${commitRes.stderr}`,
          500,
        );
      }

      const shaRes = await this.runner.run({
        executable: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: repoPath,
      });
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

      await this.runner.run({
        executable: 'git',
        args: ['worktree', 'prune'],
        cwd: input.repoPath,
      });

      if (existsSync(worktreePath)) {
        if (input.changeId) {
          throw new ForgeError(
            'CONFLICT',
            `Worktree path "${worktreePath}" already exists for active Change`,
            409,
          );
        }
        await this.runner.run({
          executable: 'git',
          args: ['worktree', 'remove', '--force', worktreePath],
          cwd: input.repoPath,
        });
        rmSync(worktreePath, {recursive: true, force: true});
      }

      let baseCommitSha = defaultHead;
      if (input.baseRef) {
        const refRes = await this.runner.run({
          executable: 'git',
          args: ['rev-parse', '--verify', input.baseRef],
          cwd: input.repoPath,
        });
        if (refRes.exitCode === 0 && refRes.stdout.trim().length > 0) {
          baseCommitSha = refRes.stdout.trim();
        }
      }

      const addRes = await this.runner.run({
        executable: 'git',
        args: [
          'worktree',
          'add',
          '--force',
          '-B',
          branchName,
          worktreePath,
          baseCommitSha,
        ],
        cwd: input.repoPath,
      });

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
        await this.runner.run({
          executable: 'git',
          args: ['add', '-A'],
          cwd: input.worktreePath,
        });

        const diffCached = await this.runner.run({
          executable: 'git',
          args: [
            '-c',
            'core.quotePath=false',
            'diff',
            '--cached',
            '--name-only',
            '-z',
          ],
          cwd: input.worktreePath,
        });
        const changedFiles = diffCached.stdout
          .split('\0')
          .map(s => s.trim())
          .filter(Boolean);

        const commitRes = await this.runner.run({
          executable: 'git',
          args: [
            '-c',
            'user.name=ForgeOps',
            '-c',
            'user.email=forgeops@local',
            'commit',
            '--allow-empty',
            '-m',
            input.message,
          ],
          cwd: input.worktreePath,
        });

        if (commitRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `Checkpoint commit failed: ${commitRes.stderr || commitRes.stdout}`,
            500,
          );
        }

        const revRes = await this.runner.run({
          executable: 'git',
          args: ['rev-parse', 'HEAD'],
          cwd: input.worktreePath,
        });
        const commitSha = revRes.stdout.trim();
        const shortSha = commitSha.slice(0, 8);
        const cleanChange = sanitizeRefSegment(input.changeCode);
        const cleanNode = sanitizeRefSegment(input.nodeCode);
        const gitTag = `forgeops/${cleanChange}/${cleanNode}-${shortSha}`;

        await this.runner.run({
          executable: 'git',
          args: ['tag', '-f', gitTag, commitSha],
          cwd: input.worktreePath,
        });

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

        const refRes = await this.runner.run({
          executable: 'git',
          args: ['update-ref', rescueRef, 'HEAD'],
          cwd: input.worktreePath,
        });
        if (refRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `Failed to create rescue ref "${rescueRef}": ${refRes.stderr}`,
            500,
          );
        }

        const resetRes = await this.runner.run({
          executable: 'git',
          args: ['reset', '--hard', input.targetCommitSha],
          cwd: input.worktreePath,
        });
        if (resetRes.exitCode !== 0) {
          throw new ForgeError(
            'INTERNAL_ERROR',
            `Failed to rewind worktree to "${input.targetCommitSha}": ${resetRes.stderr}`,
            500,
          );
        }

        await this.runner.run({
          executable: 'git',
          args: ['clean', '-fd'],
          cwd: input.worktreePath,
        });

        const headRes = await this.runner.run({
          executable: 'git',
          args: ['rev-parse', 'HEAD'],
          cwd: input.worktreePath,
        });

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
        await this.runner.run({
          executable: 'git',
          args: ['reset', '--hard', 'HEAD'],
          cwd: worktreePath,
        });
        await this.runner.run({
          executable: 'git',
          args: ['clean', '-fd'],
          cwd: worktreePath,
        });
        return;
      }

      const [trackedRes, untrackedRes] = await Promise.all([
        this.runner.run({
          executable: 'git',
          args: [
            '-c',
            'core.quotePath=false',
            'diff',
            '--name-only',
            '-z',
            'HEAD',
          ],
          cwd: worktreePath,
        }),
        this.runner.run({
          executable: 'git',
          args: [
            '-c',
            'core.quotePath=false',
            'ls-files',
            '--others',
            '--exclude-standard',
            '-z',
          ],
          cwd: worktreePath,
        }),
      ]);

      const trackedMatches = trackedRes.stdout
        .split('\0')
        .map(s => s.trim())
        .filter(f => f && isFileInsideScope(f, fileScope));
      if (trackedMatches.length > 0) {
        await this.runner.run({
          executable: 'git',
          args: ['checkout', 'HEAD', '--', ...trackedMatches],
          cwd: worktreePath,
        });
      }

      const untrackedMatches = untrackedRes.stdout
        .split('\0')
        .map(s => s.trim())
        .filter(f => f && isFileInsideScope(f, fileScope));
      for (const rel of untrackedMatches) {
        const safe = this.resolveInside(worktreePath, rel);
        rmSync(safe, {force: true});
      }
    });
  }

  async snapshotWorkingTree(worktreePath: string): Promise<readonly string[]> {
    if (!existsSync(worktreePath)) {
      return [];
    }
    const [trackedRes, untrackedRes] = await Promise.all([
      this.runner.run({
        executable: 'git',
        args: [
          '-c',
          'core.quotePath=false',
          'diff',
          '--name-only',
          '-z',
          'HEAD',
        ],
        cwd: worktreePath,
      }),
      this.runner.run({
        executable: 'git',
        args: [
          '-c',
          'core.quotePath=false',
          'ls-files',
          '--others',
          '--exclude-standard',
          '-z',
        ],
        cwd: worktreePath,
      }),
    ]);
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
      await this.runner.run({
        executable: 'git',
        args: ['checkout', 'HEAD', '--', ...files],
        cwd: worktreePath,
      });
      for (const rel of files) {
        const safe = this.resolveInside(worktreePath, rel);
        if (existsSync(safe)) {
          rmSync(safe, {recursive: true, force: true});
        }
      }
    });
  }

  async diffSinceCommit(
    worktreePath: string,
    fromCommitSha: string,
  ): Promise<WorktreeDiffSummary> {
    const [statRes, numstatRes, patchRes, namesRes, untrackedRes] =
      await Promise.all([
        this.runner.run({
          executable: 'git',
          args: ['-c', 'core.quotePath=false', 'diff', '--stat', fromCommitSha],
          cwd: worktreePath,
        }),
        this.runner.run({
          executable: 'git',
          args: [
            '-c',
            'core.quotePath=false',
            'diff',
            '--numstat',
            fromCommitSha,
          ],
          cwd: worktreePath,
        }),
        this.runner.run({
          executable: 'git',
          args: ['-c', 'core.quotePath=false', 'diff', fromCommitSha],
          cwd: worktreePath,
        }),
        this.runner.run({
          executable: 'git',
          args: [
            '-c',
            'core.quotePath=false',
            'diff',
            '--name-only',
            '-z',
            fromCommitSha,
          ],
          cwd: worktreePath,
        }),
        this.runner.run({
          executable: 'git',
          args: [
            '-c',
            'core.quotePath=false',
            'ls-files',
            '--others',
            '--exclude-standard',
            '-z',
          ],
          cwd: worktreePath,
        }),
      ]);

    const trackedFiles = namesRes.stdout
      .split('\0')
      .map(s => s.trim())
      .filter(Boolean);
    const untrackedFiles = untrackedRes.stdout
      .split('\0')
      .map(s => s.trim())
      .filter(Boolean);

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
    const res = await this.runner.run({
      executable: 'git',
      args: ['merge-tree', '--write-tree', targetBranch, changeBranch],
      cwd: repoPath,
    });
    if (res.exitCode === 0) {
      return {
        clean: true,
        conflictFiles: [],
        diagnostic: `Clean merge-tree against ${targetBranch}`,
      };
    }
    const combined = `${res.stdout}\n${res.stderr}`;
    if (/CONFLICT/i.test(combined)) {
      const conflictFiles = Array.from(
        new Set(
          combined
            .split(/\r?\n/)
            .filter(l => /CONFLICT/i.test(l))
            .map(l => l.trim().slice(0, 200)),
        ),
      );
      return {
        clean: false,
        conflictFiles,
        diagnostic: `Merge conflicts detected against ${targetBranch}`,
      };
    }
    // Fallback if git lacks --write-tree
    const baseRes = await this.runner.run({
      executable: 'git',
      args: ['merge-base', targetBranch, changeBranch],
      cwd: repoPath,
    });
    return {
      clean: baseRes.exitCode === 0,
      conflictFiles: [],
      diagnostic:
        baseRes.exitCode === 0
          ? `Common ancestor verified (${baseRes.stdout.trim().slice(0, 8)})`
          : combined.trim().slice(0, 240) || 'Unable to verify merge readiness',
    };
  }

  async cleanupOrphanWorktrees(repoPath: string): Promise<readonly string[]> {
    return this.locks.withRepoLock(repoPath, this.runner, async () => {
      const pruneRes = await this.runner.run({
        executable: 'git',
        args: ['worktree', 'prune', '-v'],
        cwd: repoPath,
      });
      const combined = `${pruneRes.stdout}\n${pruneRes.stderr}`;
      return combined
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    });
  }
}
