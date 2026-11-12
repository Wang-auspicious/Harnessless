/**
 * Domain-Driven Design (DDD) Ubiquitous Language grounding & drift detection.
 * Zero I/O dependencies.
 */

import type {DomainTermEntry} from '../shared/types.ts';

export interface TerminologyDriftFinding {
  readonly forbiddenAlias: string;
  readonly canonicalTerm: string;
  readonly boundedContext: string;
  readonly lineNumber: number;
  readonly lineExcerpt: string;
}

export function selectTermsForRepo(
  terms: readonly DomainTermEntry[],
  repoId: string,
  boundedContext?: string,
): DomainTermEntry[] {
  return terms.filter(term => {
    if (term.owningRepoIds.length === 0) {
      return true;
    }
    if (term.owningRepoIds.includes(repoId)) {
      return true;
    }
    return Boolean(boundedContext && term.boundedContext === boundedContext);
  });
}

export function renderUbiquitousLanguageSection(
  terms: readonly DomainTermEntry[],
): string {
  if (terms.length === 0) {
    return 'No domain-specific Ubiquitous Language restrictions registered.';
  }
  const lines = [
    '### DDD Ubiquitous Language Contract (Mandatory)',
    '| Bounded Context | Canonical Identifier | Business Label | Definition | Forbidden Synonyms |',
    '| :--- | :--- | :--- | :--- | :--- |',
  ];
  for (const t of terms) {
    const forbidden =
      t.forbiddenAliases.length > 0 ? t.forbiddenAliases.join(', ') : '(none)';
    lines.push(
      `| ${t.boundedContext} | \`${t.canonicalTerm}\` | ${t.localLabel} | ${t.definition} | ${forbidden} |`,
    );
  }
  return lines.join('\n');
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scans newly added diff lines (or raw source/spec text) for prohibited
 * synonyms defined in the Ubiquitous Language registry.
 */
export function detectTerminologyDrift(
  textOrUnifiedDiff: string,
  terms: readonly DomainTermEntry[],
): TerminologyDriftFinding[] {
  if (terms.length === 0 || textOrUnifiedDiff.trim().length === 0) {
    return [];
  }

  const isDiff =
    textOrUnifiedDiff.includes('@@') || textOrUnifiedDiff.startsWith('diff ');
  const lines = textOrUnifiedDiff.split(/\r?\n/);
  const findings: TerminologyDriftFinding[] = [];

  lines.forEach((rawLine, idx) => {
    if (isDiff) {
      if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) {
        return;
      }
    }
    const cleanLine = isDiff ? rawLine.slice(1) : rawLine;
    for (const term of terms) {
      for (const alias of term.forbiddenAliases) {
        const trimmed = alias.trim();
        if (trimmed.length < 2) {
          continue;
        }
        // Match identifier boundaries including PascalCase / camelCase / snake_case.
        const pattern = new RegExp(
          `(?:^|[^A-Za-z0-9]|(?<=[a-z])(?=[A-Z]))${escapeRegex(trimmed)}(?=$|[^A-Za-z0-9]|[A-Z])`,
          'i',
        );
        if (pattern.test(cleanLine)) {
          // Ignore lines that are explicitly documenting the forbidden alias table itself.
          if (
            cleanLine.includes(term.canonicalTerm) &&
            cleanLine.includes('|')
          ) {
            continue;
          }
          findings.push({
            forbiddenAlias: trimmed,
            canonicalTerm: term.canonicalTerm,
            boundedContext: term.boundedContext,
            lineNumber: idx + 1,
            lineExcerpt: cleanLine.trim().slice(0, 140),
          });
        }
      }
    }
  });

  return findings;
}
