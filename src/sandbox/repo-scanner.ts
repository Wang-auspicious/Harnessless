import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {extname, join} from 'node:path';
import {
  analyzeScannedCodebase,
  type ScannedCommit,
  type ScannedRepoDescriptor,
  type ScannedRepoFile,
} from '../core/codebase-probe.ts';
import type {RepositoryEntry} from '../shared/types.ts';
import type {CodebaseProbeReport} from '../shared/v3-types.ts';
import type {IGitWorktreeManager, ISandboxProcessRunner} from './contracts.ts';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-renderer',
  'build',
  'out',
  '.next',
  'coverage',
  'target',
  '.forgeops',
  '.isolated',
  '__pycache__',
  '.venv',
]);

const SKIP_FILENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
]);

const BINARY_OR_ASSET_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.sqlite',
  '.db',
  '.mp4',
  '.webm',
  '.mp3',
  '.pyc',
]);

const MAX_FILES_PER_REPO = 250;
const MAX_BYTES_PER_FILE = 65_536;

export function detectRepoVerifyCommand(
  repoRoot: string,
  configured: string,
): string {
  const trimmed = configured.trim();
  if (trimmed && trimmed !== 'git status --short') {
    return trimmed;
  }

  const pkgPath = join(repoRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      if (typeof scripts['verify'] === 'string') return 'npm run verify';
      if (typeof scripts['verify:gates'] === 'string')
        return 'npm run verify:gates';
      if (
        typeof scripts['test'] === 'string' &&
        !scripts['test'].includes('no test specified')
      ) {
        return 'npm test';
      }
      if (typeof scripts['typecheck'] === 'string') return 'npm run typecheck';
      if (typeof scripts['build'] === 'string') return 'npm run build';
    } catch {
      // Ignore malformed package.json during probe.
    }
  }
  if (existsSync(join(repoRoot, 'go.mod'))) return 'go test ./...';
  if (existsSync(join(repoRoot, 'Cargo.toml'))) return 'cargo test';
  if (
    existsSync(join(repoRoot, 'pyproject.toml')) ||
    existsSync(join(repoRoot, 'pytest.ini'))
  ) {
    return 'pytest';
  }
  return trimmed || 'git status --short';
}

export function parseGitLogWithFiles(
  repoId: string,
  stdout: string,
): ScannedCommit[] {
  const commits: ScannedCommit[] = [];
  let current: {
    sha: string;
    subject: string;
    author: string;
    committedAt: string;
    files: string[];
  } | null = null;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('COMMIT\x1f')) {
      if (current) {
        commits.push({repoId, ...current});
      }
      const parts = line.split('\x1f');
      current = {
        sha: parts[1] ?? '',
        subject: parts[2] ?? '',
        author: parts[3] ?? '',
        committedAt: parts[4] ?? '',
        files: [],
      };
    } else if (current) {
      current.files.push(line.replace(/\\/g, '/'));
    }
  }
  if (current) {
    commits.push({repoId, ...current});
  }
  return commits;
}

export async function readRecentGitCommits(
  runner: ISandboxProcessRunner,
  repoId: string,
  repoPath: string,
  sinceSha?: string,
  limit = 12,
): Promise<ScannedCommit[]> {
  if (!existsSync(join(repoPath, '.git'))) {
    return [];
  }
  const rangeArgs =
    sinceSha && /^[0-9a-f]{7,40}$/i.test(sinceSha)
      ? [`${sinceSha}..HEAD`, '-n', String(limit)]
      : ['-n', String(limit)];
  try {
    const res = await runner.run({
      executable: 'git',
      args: [
        'log',
        ...rangeArgs,
        '--pretty=format:COMMIT%x1f%H%x1f%s%x1f%an%x1f%aI',
        '--name-only',
      ],
      cwd: repoPath,
      extraEnv: {LC_ALL: 'C'},
      timeoutMs: 4000,
    });
    if (res.exitCode !== 0 && sinceSha) {
      const fallback = await runner.run({
        executable: 'git',
        args: [
          'log',
          '-n',
          String(limit),
          '--pretty=format:COMMIT%x1f%H%x1f%s%x1f%an%x1f%aI',
          '--name-only',
        ],
        cwd: repoPath,
        extraEnv: {LC_ALL: 'C'},
        timeoutMs: 4000,
      });
      return fallback.exitCode === 0
        ? parseGitLogWithFiles(repoId, fallback.stdout)
        : [];
    }
    return res.exitCode === 0 ? parseGitLogWithFiles(repoId, res.stdout) : [];
  } catch {
    return [];
  }
}

function collectFilesInRepo(
  worktrees: IGitWorktreeManager,
  repo: RepositoryEntry,
): ScannedRepoFile[] {
  if (!existsSync(repo.localPath)) {
    return [];
  }
  const collected: ScannedRepoFile[] = [];
  const queue: string[] = [''];

  while (queue.length > 0 && collected.length < MAX_FILES_PER_REPO) {
    const relDir = queue.shift()!;
    let absDir: string;
    try {
      absDir = relDir
        ? worktrees.resolveInside(repo.localPath, relDir)
        : worktrees.resolveInside(repo.localPath, '.');
    } catch {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(absDir, {withFileTypes: true});
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (collected.length >= MAX_FILES_PER_REPO) break;
      const name = ent.name;
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
        queue.push(relDir ? `${relDir}/${name}` : name);
        continue;
      }
      if (!ent.isFile()) continue;
      const lower = name.toLowerCase();
      if (
        SKIP_FILENAMES.has(lower) ||
        BINARY_OR_ASSET_EXTS.has(extname(lower))
      ) {
        continue;
      }
      const relFile = relDir ? `${relDir}/${name}` : name;
      try {
        const absFile = worktrees.resolveInside(repo.localPath, relFile);
        const st = statSync(absFile);
        if (st.size > MAX_BYTES_PER_FILE || st.size === 0) continue;
        const buf = readFileSync(absFile);
        const probeEnd = Math.min(buf.length, 1024);
        let isBinary = false;
        for (let i = 0; i < probeEnd; i += 1) {
          if (buf[i] === 0) {
            isBinary = true;
            break;
          }
        }
        if (isBinary) continue;
        const content = buf.toString('utf8');
        const lineCount = content.split(/\r?\n/).length;
        collected.push({
          repoId: repo.id,
          repoName: repo.name,
          filePath: relFile.replace(/\\/g, '/'),
          content,
          lineCount,
        });
      } catch {
        continue;
      }
    }
  }

  return collected;
}

export async function scanRepositoriesForProbe(
  worktrees: IGitWorktreeManager,
  runner: ISandboxProcessRunner,
  repos: readonly RepositoryEntry[],
  rawIntent: string,
): Promise<CodebaseProbeReport> {
  const descriptors: ScannedRepoDescriptor[] = [];
  const allFiles: ScannedRepoFile[] = [];
  const allCommits: ScannedCommit[] = [];

  for (const repo of repos) {
    const detectedCmd = detectRepoVerifyCommand(
      repo.localPath,
      repo.verifyCommand,
    );
    descriptors.push({
      repoId: repo.id,
      repoName: repo.name,
      verifyCommand: detectedCmd,
    });
    allFiles.push(...collectFilesInRepo(worktrees, repo));
    const commits = await readRecentGitCommits(
      runner,
      repo.id,
      repo.localPath,
      undefined,
      12,
    );
    allCommits.push(...commits);
  }

  return analyzeScannedCodebase({
    repos: descriptors,
    files: allFiles,
    commits: allCommits,
    rawIntent,
  });
}
