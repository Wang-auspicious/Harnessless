import type {FailureDiagnosis} from '../shared/v3-types.ts';
import {sha256Text} from './canonical-json.ts';

const TEST_FILE_PATH_RE =
  /(?:^|\/)(?:__tests__|tests?|spec|verify)\/|(?:\.(?:test|spec|verify)\.[a-z0-9]+$)/i;

const SKIP_MARKER_RE =
  /\.(?:skip|only)\s*\(|\b(?:xit|xdescribe|xtest)\s*\(|@pytest\.mark\.skip|\bt\.Skip\s*\(/;

const ASSERTION_CALL_RE =
  /\b(?:assert|expect|should|verify)\b|\.(?:toBe|toEqual|equal|ok|match|throws|rejects)\b/;

const INFRA_ENV_RE =
  /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EADDRINUSE|ENOENT|rate[- ]?limit)\b|command not found|not recognized as an internal|Cannot find module|\b(?:401|403)\s+(?:unauthorized|forbidden)\b|timed out/i;

const SPEC_GAP_RE =
  /\b(?:DDD_DRIFT|acceptance criterion|contradict|ambiguous)\b|验收标准|需求歧义|术语漂移/i;

const DESTRUCTIVE_DDL_RE =
  /\bDROP\s+(?:TABLE|COLUMN)\b|\bALTER\s+TABLE\b.*\bRENAME\b/i;

const CONTRACT_FILE_RE =
  /(?:shared|api|contract|schema|proto|openapi|migration)/i;

export function normalizeErrorFingerprint(
  summary: string,
  diagnostics: readonly string[],
): string {
  const combined = `${summary}\n${diagnostics.join('\n')}`
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<TS>')
    .replace(/[A-Za-z]:\\[^\s:'")]+/g, '<PATH>')
    .replace(/\/(?:[\w.-]+\/){2,}[\w.-]*/g, '<PATH>')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '<HEX>')
    .replace(/\b[0-9a-f]{12,64}\b/gi, '<SHA>')
    .replace(/:\d+(?::\d+)?\b/g, ':<LINE>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
  return sha256Text(combined).slice(0, 16);
}

export function detectTestTamperingInDiff(
  patch: string,
  allowTestModification = false,
): {readonly tampered: boolean; readonly findings: readonly string[]} {
  if (allowTestModification || !patch.trim()) {
    return {tampered: false, findings: []};
  }
  const sections = patch.split(/(?=^diff --git )/m).filter(Boolean);
  const findings: string[] = [];

  for (const sec of sections) {
    const header = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(sec);
    const filePath = (header?.[2] ?? header?.[1] ?? '').trim();
    if (!filePath || !TEST_FILE_PATH_RE.test(filePath)) {
      continue;
    }

    if (/^deleted file mode /m.test(sec)) {
      findings.push(
        `Deleted existing test file "${filePath}" without approval.`,
      );
      continue;
    }

    let addedAssertions = 0;
    let removedAssertions = 0;
    let skipAdded = false;

    for (const line of sec.split(/\r?\n/)) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) {
        const body = line.slice(1);
        if (SKIP_MARKER_RE.test(body)) {
          skipAdded = true;
        }
        if (ASSERTION_CALL_RE.test(body)) {
          addedAssertions += 1;
        }
      } else if (line.startsWith('-')) {
        const body = line.slice(1);
        if (ASSERTION_CALL_RE.test(body)) {
          removedAssertions += 1;
        }
      }
    }

    if (skipAdded) {
      findings.push(
        `Added skip/only exclusion marker inside test file "${filePath}".`,
      );
    }
    if (removedAssertions >= 2 && addedAssertions === 0) {
      findings.push(
        `Removed ${removedAssertions} assertion lines without replacement in "${filePath}".`,
      );
    }
  }

  return {tampered: findings.length > 0, findings};
}

export function detectDestructiveContractChanges(
  patch: string,
): readonly string[] {
  if (!patch.trim()) {
    return [];
  }
  const warnings: string[] = [];
  const sections = patch.split(/(?=^diff --git )/m).filter(Boolean);

  for (const sec of sections) {
    const header = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(sec);
    const filePath = (header?.[2] ?? header?.[1] ?? '').trim();
    const lines = sec.split(/\r?\n/);

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const ddlMatch = DESTRUCTIVE_DDL_RE.exec(line.slice(1));
        if (ddlMatch) {
          warnings.push(
            `Destructive DDL "${ddlMatch[0]}" in ${filePath || 'patch'} — prefer Expand-Contract (add new column/table first before dropping old one).`,
          );
          break;
        }
      }
    }

    if (filePath && CONTRACT_FILE_RE.test(filePath)) {
      const removedExports = new Set<string>();
      const addedExports = new Set<string>();
      for (const line of lines) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        const m =
          /^[+-]\s*export\s+(?:async\s+)?(?:interface|type|class|function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
            line,
          );
        if (!m?.[1]) continue;
        if (line.startsWith('-')) removedExports.add(m[1]);
        if (line.startsWith('+')) addedExports.add(m[1]);
      }
      for (const name of removedExports) {
        if (!addedExports.has(name)) {
          warnings.push(
            `Removed exported symbol "${name}" in contract path ${filePath} — check downstream callers or keep a compatibility alias.`,
          );
        }
      }
    }
  }

  return warnings.slice(0, 8);
}

export function classifyFailure(input: {
  readonly summary: string;
  readonly diagnostics: readonly string[];
  readonly diffPatch?: string;
  readonly allowTestModification?: boolean;
}): FailureDiagnosis {
  const fingerprint = normalizeErrorFingerprint(
    input.summary,
    input.diagnostics,
  );
  const tampering = detectTestTamperingInDiff(
    input.diffPatch ?? '',
    Boolean(input.allowTestModification),
  );
  if (tampering.tampered) {
    return {
      category: 'test_tampering',
      fingerprint,
      plainTitleZh: '拦截：检测到绕过或弱化现有测试',
      plainTitleEn: 'Blocked: test suite weakening or deletion detected',
      plainAdviceZh:
        '禁止通过跳过用例或删减断言来凑绿灯。请恢复原测试或先在需求评审阶段申请修订测试。',
      plainAdviceEn:
        'Do not skip or delete assertions to force green checks. Fix the implementation or request a spec test amendment.',
      shouldRetryCoder: false,
      evidenceLines: tampering.findings.slice(0, 5),
    };
  }

  const combined = `${input.summary}\n${input.diagnostics.join('\n')}`;
  if (INFRA_ENV_RE.test(combined)) {
    return {
      category: 'infra_env',
      fingerprint,
      plainTitleZh: '环境或外部依赖故障（非代码写错）',
      plainTitleEn: 'Environment or external dependency fault',
      plainAdviceZh:
        '失败来自端口占用、依赖缺失、网络或鉴权问题，重试改业务代码只会越改越乱；请修复本地环境后点击继续。',
      plainAdviceEn:
        'Failure stems from environment/dependency/network/auth state rather than business logic; fix the environment before resuming.',
      shouldRetryCoder: false,
      evidenceLines: input.diagnostics.slice(0, 4),
    };
  }

  if (SPEC_GAP_RE.test(combined)) {
    return {
      category: 'spec_gap',
      fingerprint,
      plainTitleZh: '需求规格或术语约束冲突',
      plainTitleEn: 'Specification or DDD terminology conflict',
      plainAdviceZh:
        '实现与锁定术语/验收标准存在偏差或规格留白，建议补充澄清后再继续执行。',
      plainAdviceEn:
        'Output conflicts with locked DDD terms or unclear acceptance criteria; clarify before retrying.',
      shouldRetryCoder: false,
      evidenceLines: input.diagnostics.slice(0, 4),
    };
  }

  return {
    category: 'logic_bug',
    fingerprint,
    plainTitleZh: '代码实现或测试断言未通过',
    plainTitleEn: 'Implementation or logic assertion failed',
    plainAdviceZh:
      '系统可回退当前节点重做；如连续报同一错误，建议打开 IDE 在断点处手工接管修复。',
    plainAdviceEn:
      'Safe to rewind and retry within budget, or open in IDE for manual breakpoint handover.',
    shouldRetryCoder: true,
    evidenceLines: input.diagnostics.slice(0, 4),
  };
}

export function detectRetrySpin(
  history: readonly {readonly fingerprint: string; readonly diffHash: string}[],
): {readonly spinning: boolean; readonly reason: string | null} {
  const len = history.length;
  if (len >= 2) {
    const last = history[len - 1]!;
    const prev = history[len - 2]!;
    if (last.fingerprint && last.fingerprint === prev.fingerprint) {
      return {spinning: true, reason: 'consecutive_identical_error'};
    }
  }
  if (len >= 3) {
    const curr = history[len - 1]!;
    const twoBack = history[len - 3]!;
    if (curr.diffHash && curr.diffHash === twoBack.diffHash) {
      return {spinning: true, reason: 'oscillating_diff_aba'};
    }
  }
  return {spinning: false, reason: null};
}
