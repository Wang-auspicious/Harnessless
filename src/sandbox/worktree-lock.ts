import {resolve} from 'node:path';
import type {ISandboxProcessRunner} from './contracts.ts';

export class WorktreeLockManager {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly commonDirCache = new Map<string, string>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const normalizedKey =
      process.platform === 'win32' ? key.toLowerCase() : key;
    const prev = this.queues.get(normalizedKey) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(r => {
      release = r;
    });
    const tail = prev.then(() => next);
    this.queues.set(normalizedKey, tail);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.queues.get(normalizedKey) === tail) {
        this.queues.delete(normalizedKey);
      }
    }
  }

  async resolveCommonGitDir(
    repoOrWorktreePath: string,
    runner: ISandboxProcessRunner,
  ): Promise<string> {
    const abs = resolve(repoOrWorktreePath).replace(/^\\\\\?\\/, '');
    const cacheKey = process.platform === 'win32' ? abs.toLowerCase() : abs;
    const cached = this.commonDirCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    try {
      const res = await runner.run({
        executable: 'git',
        args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        cwd: abs,
        timeoutMs: 5_000,
      });
      if (res.exitCode === 0 && res.stdout.trim().length > 0) {
        const common = resolve(res.stdout.trim()).replace(/^\\\\\?\\/, '');
        this.commonDirCache.set(cacheKey, common);
        return common;
      }
    } catch {
      // Fallback to directory path before repository initialization.
    }
    return abs;
  }

  async withRepoLock<T>(
    repoOrWorktreePath: string,
    runner: ISandboxProcessRunner,
    fn: () => Promise<T>,
  ): Promise<T> {
    const commonDir = await this.resolveCommonGitDir(
      repoOrWorktreePath,
      runner,
    );
    return this.withLock(commonDir, fn);
  }
}
