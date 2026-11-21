/**
 * Governance Policy Engine: Permission Tiers (`turbo | supervised | strict`),
 * blocked-command redlines, and 4-Section Epistemic Rollover formatting.
 */

import type {EpistemicHandoff, PermissionTier} from '../shared/types.ts';
import type {TriageTrack} from '../shared/v3-types.ts';

export function canAutoAdvanceGate(
  tier: PermissionTier,
  gateStage: 'G1' | 'G2' | 'G3',
  qualityScore: number,
): boolean {
  if (tier === 'turbo') {
    return qualityScore >= 0.85;
  }
  if (tier === 'supervised') {
    return gateStage === 'G2' && qualityScore >= 0.85;
  }
  return false;
}

export function canAutoMaterializeGhostNode(
  tier: PermissionTier,
  existingGhostCountInChange: number,
): boolean {
  if (tier === 'turbo') {
    return existingGhostCountInChange < 6;
  }
  return false;
}

export function canAutoApproveGhostAmendment(
  tier: PermissionTier,
  existingGhostCountInChange: number,
  gateCommand: string | undefined,
  repoVerifyCommand: string,
): boolean {
  const customCmd = (gateCommand ?? '').trim();
  if (customCmd.length > 0 && customCmd !== repoVerifyCommand.trim()) {
    return false;
  }
  return canAutoMaterializeGhostNode(tier, existingGhostCountInChange);
}

const HARD_COMMAND_REGEXES: readonly {
  readonly label: string;
  readonly pattern: RegExp;
}[] = [
  {
    label: 'recursive root/force rm',
    pattern: /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  },
  {
    label: 'git force push',
    pattern: /\bgit\s+push\b.*(?:--force|-f\b|--force-with-lease)/i,
  },
  {
    label: 'git hard reset origin',
    pattern: /\bgit\s+reset\s+--hard\s+origin\b/i,
  },
  {
    label: 'piped remote shell execution',
    pattern: /\|\s*(?:sh|bash|zsh|pwsh|powershell|cmd)\b/i,
  },
  {
    label: 'disk format / raw overwrite',
    pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?|dd\s+if=|format\s+[a-z]:)\b/i,
  },
];

export function findBlockedCommandViolation(
  argv: readonly string[],
  blockedPatterns: readonly string[],
): string | null {
  if (argv.length === 0) {
    return 'Empty command argv';
  }
  const normalized = argv.join(' ').replace(/\s+/g, ' ').trim();
  const lowered = normalized.toLowerCase();

  for (const rule of HARD_COMMAND_REGEXES) {
    if (rule.pattern.test(normalized)) {
      return `Command violates Soul Constitution redline: "${rule.label}"`;
    }
  }

  const hardBuiltins = ['rm -rf /', 'del /f /s /q c:\\', 'rd /s /q c:\\'];
  for (const rule of [...hardBuiltins, ...blockedPatterns]) {
    const clean = rule.replace(/\s+/g, ' ').trim().toLowerCase();
    if (clean.length > 0 && lowered.includes(clean)) {
      return `Command violates Soul Constitution redline: "${rule}"`;
    }
  }
  return null;
}

const HIGH_RISK_DOMAIN_PATTERN =
  /\b(auth|oauth|jwt|rbac|permission|billing|payment|settlement|ledger|encrypt|secret|compliance|migration|schema|security|delete|drop)\b|权限|鉴权|认证|结算|支付|账本|安全|合规|迁移|加密/i;

export function triageMissionIntent(input: {
  readonly rawIntent: string;
  readonly repoCount: number;
  readonly documentCount: number;
  readonly requestedTrack?: TriageTrack;
  readonly defaultTrack?: TriageTrack;
}): {
  readonly track: TriageTrack;
  readonly rationale: string;
  readonly triggers: readonly string[];
} {
  if (input.requestedTrack) {
    return {
      track: input.requestedTrack,
      rationale: `Explicitly selected ${input.requestedTrack} triage track.`,
      triggers: ['explicit_selection'],
    };
  }
  const triggers: string[] = [];
  if (input.repoCount > 1) {
    triggers.push('multi_repo_epic');
  }
  if (HIGH_RISK_DOMAIN_PATTERN.test(input.rawIntent)) {
    triggers.push('sensitive_domain');
  }
  if (input.documentCount >= 2 || input.rawIntent.length > 900) {
    triggers.push('high_requirement_density');
  }
  if (/[?？]|或者|待定|TBD|unclear|ambiguous/i.test(input.rawIntent)) {
    triggers.push('unresolved_ambiguity');
  }

  if (
    triggers.includes('multi_repo_epic') ||
    triggers.includes('sensitive_domain') ||
    triggers.length >= 2
  ) {
    return {
      track: 'full_hama',
      rationale: `Escalated to full_hama due to: ${triggers.join(', ')}.`,
      triggers,
    };
  }
  if (
    triggers.length === 1 ||
    input.rawIntent.length > 220 ||
    input.defaultTrack === 'standard'
  ) {
    return {
      track: 'standard',
      rationale:
        triggers.length > 0
          ? `Routed to standard multi-role review (${triggers.join(', ')}).`
          : 'Moderate feature scope routed to standard multi-role review.',
      triggers,
    };
  }
  return {
    track: 'express',
    rationale: 'Clear single-repo scope eligible for express SDD convergence.',
    triggers: [],
  };
}

/**
 * Formats the 4-section epistemic handoff block so downstream fresh-context
 * rounds never confuse prior agent hypotheses with spec-confirmed facts.
 */
export function renderEpistemicRolloverBlock(
  handoff: EpistemicHandoff,
  sessionAnchorId?: string,
): string {
  const bullets = (items: readonly string[]): string =>
    items.length > 0 ? items.map(i => `- ${i}`).join('\n') : '- (none)';

  return [
    '## Epistemic Slice Handoff (Authority Boundary)',
    sessionAnchorId ? `Evidence Session Anchor: \`${sessionAnchorId}\`` : '',
    '',
    '### 1. SPEC-CONFIRMED FACTS (Verified against Spec or Source)',
    bullets(handoff.specConfirmedFacts),
    '',
    '### 2. AGENT HYPOTHESES (Unverified — NEVER treat as locked truth without checking)',
    bullets(handoff.agentHypotheses),
    '',
    '### 3. OPEN CONFLICTS',
    bullets(handoff.openConflicts),
    '',
    '### 4. UNCERTIFIED ACCEPTANCE CRITERIA',
    bullets(handoff.uncertifiedCriteria),
  ]
    .filter(line => line !== '')
    .join('\n');
}
