/**
 * Governance Policy Engine: Permission Tiers (`turbo | supervised | strict`),
 * blocked-command redlines, and 4-Section Epistemic Rollover formatting.
 */

import type {EpistemicHandoff, PermissionTier} from '../shared/types.ts';

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

/**
 * Checks whether an argv command violates global SoulConstitution redlines.
 */
export function findBlockedCommandViolation(
  argv: readonly string[],
  blockedPatterns: readonly string[],
): string | null {
  if (argv.length === 0) {
    return 'Empty command argv';
  }
  const joined = argv.join(' ').toLowerCase();
  const hardBuiltins = [
    'rm -rf /',
    'format ',
    'mkfs',
    'git push --force',
    'git reset --hard origin',
    'del /f /s /q c:\\',
  ];
  for (const rule of [...hardBuiltins, ...blockedPatterns]) {
    const normalized = rule.trim().toLowerCase();
    if (normalized.length > 0 && joined.includes(normalized)) {
      return `Command violates Soul Constitution redline: "${rule}"`;
    }
  }
  return null;
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
