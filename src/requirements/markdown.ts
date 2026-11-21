import type {
  AcceptanceCriterionV3,
  ApprovedRequirementsBaseline,
  PrdDocument,
} from '../shared/v3-types.ts';

export function acceptanceText(ac: AcceptanceCriterionV3): string {
  return `[${ac.id}] (${ac.key}) GIVEN ${ac.given} WHEN ${ac.when} THEN ${ac.then}`;
}

export function renderPrdMarkdown(
  prd: PrdDocument,
  baseline?: ApprovedRequirementsBaseline | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${prd.title}`);
  lines.push('');

  if (baseline) {
    lines.push('## Baseline Seal');
    lines.push(`- Baseline ID: \`${baseline.id}\` (rev ${baseline.revision})`);
    lines.push(`- Mode: \`${baseline.mode}\``);
    lines.push(`- SHA-256: \`${baseline.sha256}\``);
    lines.push(
      `- Approval: \`${baseline.approval.id}\` (${baseline.approval.action} by ${baseline.approval.actor})`,
    );
    if (baseline.conditionalApproval) {
      lines.push(
        `- Conditions Released: \`${baseline.conditionalApproval.id}\` (${baseline.conditionalApproval.action})`,
      );
    }
    lines.push(
      `- Confirmation: \`${baseline.confirmation.id}\` (${baseline.confirmation.action} by ${baseline.confirmation.actor})`,
    );
    lines.push('');
  }

  lines.push('## 1. Background & Scenarios');
  lines.push(prd.background);
  lines.push('');
  for (const sc of prd.scenarios) {
    lines.push(`- ${sc}`);
  }
  lines.push('');

  lines.push('## 2. Goals & Summary');
  lines.push(prd.summary);
  lines.push('');
  for (const goal of prd.goals) {
    lines.push(`- ${goal}`);
  }
  lines.push('');

  lines.push('## 3. Functional & Non-Functional Requirements');
  lines.push('');
  for (const req of prd.requirements) {
    lines.push(
      `### ${req.id} [${req.kind.toUpperCase()} | ${req.priority.toUpperCase()}] ${req.title}`,
    );
    lines.push(
      `- Scope Key: \`${req.scopeKey}\`${req.supersedesScopeKey ? ` (supersedes \`${req.supersedesScopeKey}\`)` : ''}`,
    );
    lines.push(`- State: \`${req.state}\``);
    lines.push(`- Value: ${req.value}`);
    lines.push('');
    lines.push(req.description);
    lines.push('');
    if (req.dependencies.length > 0) {
      lines.push(`- Dependencies: ${req.dependencies.join(', ')}`);
    }
    if (req.constraints.length > 0) {
      lines.push(`- Constraints: ${req.constraints.join('; ')}`);
    }
    lines.push('- Acceptance Criteria:');
    for (const ac of req.acceptance) {
      lines.push(`  - ${acceptanceText(ac)}`);
    }
    lines.push('');
  }

  const sectionList = (heading: string, items: readonly string[]): void => {
    lines.push(heading);
    if (items.length === 0) {
      lines.push('- None');
    } else {
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }
    lines.push('');
  };

  sectionList('## 4. Technical Approach', prd.approach);
  sectionList('## 5. Business Rules', prd.businessRules);
  sectionList('## 6. Constraints & Out of Scope', [
    ...prd.constraints.map(c => `[Constraint] ${c}`),
    ...prd.outOfScope.map(o => `[Out of Scope] ${o}`),
  ]);
  sectionList('## 7. Tradeoffs, Risks & External Dependencies', [
    ...prd.tradeoffs.map(t => `[Tradeoff] ${t}`),
    ...prd.risks.map(r => `[Risk] ${r}`),
    ...prd.externalDependencies.map(e => `[Dependency] ${e}`),
  ]);
  if (prd.unresolved.length > 0) {
    sectionList('## 8. Unresolved Advisories', prd.unresolved);
  }

  lines.push('## Traceability Matrix');
  lines.push('');
  lines.push(
    '| Requirement ID | Scope Key | Issues | Acceptance IDs | Proposal | Approval |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const link of prd.trace) {
    lines.push(
      `| ${link.requirementId} | ${link.scopeKey} | ${link.issueIds.join(', ')} | ${link.acceptanceIds.join(', ')} | ${link.proposal.id} (rev ${link.proposal.revision}) | ${link.approvalId} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}
