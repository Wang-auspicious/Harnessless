import type {
  CodebaseImportEdge,
  CodebaseProbeFileHit,
  CodebaseProbeReport,
  CodebaseRealityNote,
  MemoryAuthorityTier,
  TriageTrack,
} from '../shared/v3-types.ts';

export interface ScannedRepoFile {
  readonly repoId: string;
  readonly repoName: string;
  readonly filePath: string;
  readonly content: string;
  readonly lineCount: number;
}

export interface ScannedCommit {
  readonly repoId: string;
  readonly sha: string;
  readonly subject: string;
  readonly author: string;
  readonly committedAt: string;
  readonly files: readonly string[];
}

export interface ScannedRepoDescriptor {
  readonly repoId: string;
  readonly repoName: string;
  readonly verifyCommand: string;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'when',
  'then',
  'will',
  'need',
  'add',
  'fix',
  'update',
  'change',
  'make',
  'use',
  'using',
  'support',
  'should',
  'would',
  'could',
  'about',
]);

const HIGH_RISK_PATH_RE =
  /(?:auth|oauth|jwt|rbac|permission|billing|payment|settlement|ledger|encrypt|secret|compliance|migration|schema|security|shared|contract|proto|openapi)/i;

const HIGH_RISK_INTENT_RE =
  /\b(auth|oauth|jwt|rbac|permission|billing|payment|settlement|ledger|encrypt|secret|compliance|migration|schema|security|delete|drop)\b|权限|鉴权|认证|结算|支付|账本|安全|合规|迁移|加密/i;

const REVERT_SUBJECT_RE = /^(?:revert\b|回滚|回退)/i;

function normalizeSlash(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function dirnamePosix(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

function joinPosix(base: string, rel: string): string {
  const parts = [...(base ? base.split('/') : []), ...rel.split('/')];
  const stack: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      stack.pop();
    } else {
      stack.push(seg);
    }
  }
  return stack.join('/');
}

export function extractIntentKeywords(rawIntent: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (token: string): void => {
    const clean = token.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  for (const m of rawIntent.matchAll(/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g)) {
    add(m[0]);
  }

  for (const m of rawIntent.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const word = m[0];
    if (!STOP_WORDS.has(word.toLowerCase())) {
      add(word);
    }
    const camelParts = word.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g);
    if (camelParts && camelParts.length > 1) {
      for (const part of camelParts) {
        if (part.length >= 3 && !STOP_WORDS.has(part.toLowerCase())) {
          add(part);
        }
      }
    }
  }

  for (const seg of rawIntent.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const text = seg[0];
    if (text.length <= 4) {
      add(text);
      continue;
    }
    for (let i = 0; i <= text.length - 2 && out.length < 24; i += 2) {
      add(text.slice(i, Math.min(text.length, i + 3)));
    }
  }

  return out.slice(0, 24);
}

export function parseFileImportsAndExports(
  filePath: string,
  content: string,
): {readonly imports: readonly string[]; readonly exports: readonly string[]} {
  const imports = new Set<string>();
  const exportsList = new Set<string>();
  const lower = filePath.toLowerCase();

  if (lower.endsWith('.py')) {
    for (const m of content.matchAll(
      /^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w.]+))/gm,
    )) {
      const spec = (m[1] ?? m[2] ?? '').trim();
      if (spec) imports.add(spec);
    }
    for (const m of content.matchAll(
      /^(?:def|class|async\s+def)\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
    )) {
      if (m[1] && !m[1].startsWith('_')) exportsList.add(m[1]);
    }
  } else if (lower.endsWith('.go')) {
    for (const m of content.matchAll(/import\s+(?:\w+\s+)?"([^"]+)"/g)) {
      if (m[1]) imports.add(m[1]);
    }
    for (const m of content.matchAll(
      /^(?:func\s+(?:\([^)]+\)\s+)?|type\s+|const\s+|var\s+)([A-Z][A-Za-z0-9_]*)/gm,
    )) {
      if (m[1]) exportsList.add(m[1]);
    }
  } else {
    for (const m of content.matchAll(
      /(?:import|export)\s+(?:type\s+)?[\s\S]{0,160}?\sfrom\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g,
    )) {
      const spec = (m[1] ?? m[2] ?? '').trim();
      if (spec) imports.add(spec);
    }
    for (const m of content.matchAll(
      /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
    )) {
      if (m[1]) exportsList.add(m[1]);
    }
  }

  return {
    imports: [...imports].slice(0, 40),
    exports: [...exportsList].slice(0, 32),
  };
}

function resolveImportTarget(
  fromFile: string,
  specifier: string,
  repoFileSet: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const dir = dirnamePosix(fromFile);
  const rawJoined = joinPosix(dir, specifier);
  const candidates = [
    rawJoined,
    `${rawJoined}.ts`,
    `${rawJoined}.tsx`,
    `${rawJoined}.js`,
    `${rawJoined}.mjs`,
    `${rawJoined}.jsx`,
    `${rawJoined}.py`,
    `${rawJoined}/index.ts`,
    `${rawJoined}/index.tsx`,
    `${rawJoined}/index.js`,
  ];
  const strippedExt = rawJoined.replace(/\.(?:js|mjs|jsx)$/, '');
  if (strippedExt !== rawJoined) {
    candidates.push(`${strippedExt}.ts`, `${strippedExt}.tsx`);
  }
  for (const cand of candidates) {
    if (repoFileSet.has(cand)) {
      return cand;
    }
  }
  return null;
}

function pickBestExcerpt(content: string, keywords: readonly string[]): string {
  const lines = content.split(/\r?\n/);
  let bestIdx = 0;
  let bestScore = -1;
  const lowerKws = keywords.map(k => k.toLowerCase());
  const scanLimit = Math.min(lines.length, 400);

  for (let i = 0; i < scanLimit; i += 1) {
    const low = lines[i]!.toLowerCase();
    let score = 0;
    for (const kw of lowerKws) {
      if (low.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const start = Math.max(0, bestIdx - 1);
  const end = Math.min(lines.length, bestIdx + 4);
  const snippet = lines.slice(start, end).join('\n').trim();
  return snippet.length > 260 ? `${snippet.slice(0, 257)}...` : snippet;
}

export function analyzeScannedCodebase(input: {
  readonly repos: readonly ScannedRepoDescriptor[];
  readonly files: readonly ScannedRepoFile[];
  readonly commits: readonly ScannedCommit[];
  readonly rawIntent: string;
  readonly recalledMemories?: readonly {
    readonly id: string;
    readonly title: string;
    readonly authorityTier: MemoryAuthorityTier;
    readonly rejectedWarning: string | null;
  }[];
  readonly nowIso?: string;
}): CodebaseProbeReport {
  const probedAt = input.nowIso ?? new Date().toISOString();
  const keywords = extractIntentKeywords(input.rawIntent);
  const fileSetsByRepo = new Map<string, Set<string>>();

  for (const f of input.files) {
    const norm = normalizeSlash(f.filePath);
    let set = fileSetsByRepo.get(f.repoId);
    if (!set) {
      set = new Set();
      fileSetsByRepo.set(f.repoId, set);
    }
    set.add(norm);
  }

  const parsedByFile = new Map<
    string,
    {readonly imports: readonly string[]; readonly exports: readonly string[]}
  >();
  const importersByTarget = new Map<string, Set<string>>();
  const allEdges: CodebaseImportEdge[] = [];

  for (const f of input.files) {
    const normPath = normalizeSlash(f.filePath);
    const key = `${f.repoId}:${normPath}`;
    const parsed = parseFileImportsAndExports(normPath, f.content);
    parsedByFile.set(key, parsed);
    const repoSet = fileSetsByRepo.get(f.repoId);
    if (!repoSet) continue;

    for (const spec of parsed.imports) {
      const target = resolveImportTarget(normPath, spec, repoSet);
      if (!target || target === normPath) continue;
      allEdges.push({
        repoId: f.repoId,
        fromFile: normPath,
        toFile: target,
        specifier: spec,
      });
      const targetKey = `${f.repoId}:${target}`;
      let importers = importersByTarget.get(targetKey);
      if (!importers) {
        importers = new Set();
        importersByTarget.set(targetKey, importers);
      }
      importers.add(normPath);
    }
  }

  const testIntent = /\b(test|spec|verify|assert)\b|测试|断言/i.test(
    input.rawIntent,
  );
  const scoredHits: CodebaseProbeFileHit[] = [];

  for (const f of input.files) {
    const normPath = normalizeSlash(f.filePath);
    const key = `${f.repoId}:${normPath}`;
    const parsed = parsedByFile.get(key) ?? {imports: [], exports: []};
    const pathLower = normPath.toLowerCase();
    const exportsLower = parsed.exports.map(e => e.toLowerCase());
    const bodyLower = f.content.slice(0, 24_000).toLowerCase();

    let score = 0;
    const matchedKws: string[] = [];

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      let hit = false;
      if (pathLower.includes(kwLower)) {
        score += 4;
        hit = true;
      }
      if (exportsLower.some(ex => ex.includes(kwLower))) {
        score += 5;
        hit = true;
      }
      if (bodyLower.includes(kwLower)) {
        score += 2;
        hit = true;
      }
      if (hit) {
        matchedKws.push(kw);
      }
    }

    const isTestFile =
      /(?:^|\/)(?:__tests__|tests?|spec|verify)\//i.test(normPath) ||
      /\.(?:test|spec|verify)\.[a-z0-9]+$/i.test(normPath);
    if (score > 0 && isTestFile && !testIntent) {
      score = Math.max(1, score - 1);
    }

    if (score > 0 || (keywords.length === 0 && !isTestFile)) {
      const importers = [...(importersByTarget.get(key) ?? [])].slice(0, 12);
      scoredHits.push({
        repoId: f.repoId,
        repoName: f.repoName,
        filePath: normPath,
        score: score > 0 ? score : 1,
        lineCount: f.lineCount,
        matchedKeywords: matchedKws,
        exports: parsed.exports.slice(0, 10),
        importers,
        excerpt: pickBestExcerpt(f.content, keywords),
      });
    }
  }

  scoredHits.sort((a, b) => b.score - a.score || a.lineCount - b.lineCount);
  const matchedFiles = scoredHits.slice(0, 12);
  const matchedKeySet = new Set(
    matchedFiles.map(h => `${h.repoId}:${h.filePath}`),
  );
  const importEdges = allEdges
    .filter(
      e =>
        matchedKeySet.has(`${e.repoId}:${e.fromFile}`) ||
        matchedKeySet.has(`${e.repoId}:${e.toFile}`),
    )
    .slice(0, 40);

  const commitCountByFile = new Map<
    string,
    {repoId: string; filePath: string; count: number; lastSubject: string}
  >();
  const recentReverts: Array<{
    readonly repoId: string;
    readonly sha: string;
    readonly subject: string;
    readonly files: readonly string[];
  }> = [];

  for (const commit of input.commits) {
    const normFiles = commit.files.map(normalizeSlash).filter(Boolean);
    for (const filePath of normFiles) {
      const k = `${commit.repoId}:${filePath}`;
      const existing = commitCountByFile.get(k);
      if (existing) {
        existing.count += 1;
      } else {
        commitCountByFile.set(k, {
          repoId: commit.repoId,
          filePath,
          count: 1,
          lastSubject: commit.subject,
        });
      }
    }
    if (REVERT_SUBJECT_RE.test(commit.subject.trim())) {
      recentReverts.push({
        repoId: commit.repoId,
        sha: commit.sha,
        subject: commit.subject,
        files: normFiles.slice(0, 12),
      });
    }
  }

  const recentHotspots = [...commitCountByFile.values()]
    .filter(h => h.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(h => ({
      repoId: h.repoId,
      filePath: h.filePath,
      commitCount: h.count,
      lastSubject: h.lastSubject,
    }));

  const realityNotes: CodebaseRealityNote[] = [];
  const highFanIn = matchedFiles.filter(f => f.importers.length >= 3);
  if (highFanIn.length > 0) {
    const top = highFanIn[0]!;
    realityNotes.push({
      level: 'warning',
      titleZh: `${top.filePath} 被 ${top.importers.length} 个下游文件直接引用`,
      titleEn: `${top.filePath} is imported by ${top.importers.length} downstream file(s)`,
      detailZh: `修改 ${top.filePath} 的导出签名会联动影响 ${top.importers.slice(0, 4).join(', ')}，建议先保持向后兼容再切调用方。`,
      detailEn: `Changing exports in ${top.filePath} impacts ${top.importers.slice(0, 4).join(', ')}; keep signatures compatible first.`,
      relatedFiles: [top.filePath, ...top.importers.slice(0, 4)],
    });
  }

  const sensitiveMatches = matchedFiles.filter(f =>
    HIGH_RISK_PATH_RE.test(f.filePath),
  );
  const sensitiveIntent = HIGH_RISK_INTENT_RE.test(input.rawIntent);
  if (sensitiveMatches.length > 0 || sensitiveIntent) {
    realityNotes.push({
      level: 'challenge',
      titleZh: '命中高风险或公共契约路径，建议先锁定兼容性约束',
      titleEn: 'Touches high-risk or shared contract surface',
      detailZh:
        sensitiveMatches.length > 0
          ? `涉及 ${sensitiveMatches
              .slice(0, 3)
              .map(m => m.filePath)
              .join(
                ', ',
              )}，直接改字段/权限逻辑易引发回归，建议在方案中写明回退与边界检查。`
          : '需求描述涉及鉴权、账务或数据结构变更，建议补齐回滚与兼容验证。',
      detailEn:
        sensitiveMatches.length > 0
          ? `Touches ${sensitiveMatches
              .slice(0, 3)
              .map(m => m.filePath)
              .join(
                ', ',
              )}; document compatibility and rollback safeguards before coding.`
          : 'Intent mentions auth, billing, or schema changes; verify compatibility guards before coding.',
      relatedFiles: sensitiveMatches.map(m => m.filePath).slice(0, 5),
    });
  }

  const matchedFilePathSet = new Set(matchedFiles.map(m => m.filePath));
  const revertOnMatched = recentReverts.filter(rev =>
    rev.files.some(rf => matchedFilePathSet.has(rf)),
  );
  if (revertOnMatched.length > 0) {
    const rev = revertOnMatched[0]!;
    realityNotes.push({
      level: 'challenge',
      titleZh: '命中文件近期出现过 Git 回滚记录',
      titleEn: 'Recent Git revert detected on matched file(s)',
      detailZh: `提交 ${rev.sha.slice(0, 7)}（${rev.subject}）曾回滚相关文件，制定方案前务必避开相同雷区。`,
      detailEn: `Commit ${rev.sha.slice(0, 7)} (${rev.subject}) reverted matched files; review that regression before modifying.`,
      relatedFiles: rev.files.slice(0, 5),
    });
  }

  const detectedVerifyCommands = input.repos.map(r => ({
    repoId: r.repoId,
    repoName: r.repoName,
    command: r.verifyCommand.trim(),
  }));
  const weakVerifyRepos = detectedVerifyCommands.filter(
    v => !v.command || v.command === 'git status --short',
  );
  if (weakVerifyRepos.length > 0) {
    realityNotes.push({
      level: 'info',
      titleZh: '部分仓库尚未配置真实测试/构建命令',
      titleEn: 'Repository missing substantive verify command',
      detailZh: `${weakVerifyRepos.map(v => v.repoName).join(', ')} 当前校验命令为「${weakVerifyRepos[0]!.command || '空'}」，建议补充真实单测或类型检查命令以免假绿灯。`,
      detailEn: `${weakVerifyRepos.map(v => v.repoName).join(', ')} uses "${weakVerifyRepos[0]!.command || 'empty'}" verification; configure real tests or typecheck for reliable gating.`,
      relatedFiles: [],
    });
  }

  const impactedSet = new Set<string>();
  for (const hit of matchedFiles) {
    impactedSet.add(`${hit.repoId}:${hit.filePath}`);
    for (const imp of hit.importers) {
      impactedSet.add(`${hit.repoId}:${imp}`);
    }
  }
  const totalImporters = matchedFiles.reduce(
    (sum, f) => sum + f.importers.length,
    0,
  );
  if (matchedFiles.length > 6 && totalImporters > 4) {
    realityNotes.push({
      level: 'challenge',
      titleZh: '改动影响面偏大，建议拆分或收敛边界',
      titleEn: 'Wide blast radius detected across matched files and callers',
      detailZh: `本次命中 ${matchedFiles.length} 个文件并关联多处下游调用，建议先通过前置切片锁定核心接口再扩展。`,
      detailEn: `Matched ${matchedFiles.length} files with ${totalImporters} downstream caller links; narrow the first slice before fanning out.`,
      relatedFiles: matchedFiles.slice(0, 5).map(m => m.filePath),
    });
  }

  let blastRadius: 'low' | 'medium' | 'high' = 'low';
  if (
    input.repos.length > 1 ||
    sensitiveIntent ||
    sensitiveMatches.length > 0 ||
    revertOnMatched.length > 0 ||
    impactedSet.size >= 8
  ) {
    blastRadius = 'high';
  } else if (
    matchedFiles.length > 3 ||
    impactedSet.size >= 4 ||
    matchedFiles.some(m => m.importers.length >= 2) ||
    input.rawIntent.length > 220 ||
    /[?？]|或者|待定|TBD|unclear|ambiguous/i.test(input.rawIntent)
  ) {
    blastRadius = 'medium';
  }

  const recommendedTrack: TriageTrack =
    blastRadius === 'high'
      ? 'full_hama'
      : blastRadius === 'medium'
        ? 'standard'
        : 'express';

  const trackLabelZh =
    recommendedTrack === 'full_hama'
      ? '严格评审'
      : recommendedTrack === 'standard'
        ? '标准核对'
        : '快速直通';
  const plainRationaleZh = `已扫描 ${input.files.length} 个源码文件，命中 ${matchedFiles.length} 个核心文件、共牵涉 ${impactedSet.size} 个直接与下游文件；系统评估影响半径为「${blastRadius === 'high' ? '高' : blastRadius === 'medium' ? '中' : '低'}」，建议走「${trackLabelZh}」通道。`;
  const plainRationaleEn = `Scanned ${input.files.length} files, matched ${matchedFiles.length} key file(s) with ${impactedSet.size} impacted file(s); assessed ${blastRadius} blast radius -> recommended "${recommendedTrack}" track.`;

  const estimatedCostRangeUsd: readonly [number, number] =
    blastRadius === 'high'
      ? [2.0, 6.5]
      : blastRadius === 'medium'
        ? [0.6, 2.2]
        : [0.15, 0.6];

  return {
    probedAt,
    repoCount: input.repos.length,
    scannedFilesCount: input.files.length,
    matchedFiles,
    importEdges,
    detectedVerifyCommands,
    recentHotspots,
    recentReverts,
    realityNotes,
    blastRadius,
    recommendedTrack,
    plainRationaleZh,
    plainRationaleEn,
    estimatedCostRangeUsd,
    recalledMemories: input.recalledMemories ?? [],
  };
}
