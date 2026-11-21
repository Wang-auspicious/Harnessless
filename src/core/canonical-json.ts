import {createHash} from 'node:crypto';
import type {
  EvidenceBundle,
  EvidenceVerificationResult,
} from '../shared/v3-types.ts';

function normalizeCanonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item =>
      item === undefined ? null : normalizeCanonical(item),
    );
  }
  const sorted: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    const val = record[key];
    if (val !== undefined) {
      sorted[key] = normalizeCanonical(val);
    }
  }
  return sorted;
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJsonStringify(value))
    .digest('hex');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function computeEventHash(
  prevHash: string,
  eventType: string,
  actor: string,
  payloadJson: string,
): string {
  return createHash('sha256')
    .update(`${prevHash}|${eventType}|${actor}|${payloadJson}`, 'utf8')
    .digest('hex');
}

export function verifyEvidenceBundle(
  bundle: EvidenceBundle,
): EvidenceVerificationResult {
  const errors: string[] = [];
  let expectedPrev = 'GENESIS';

  const orderedEvents = [...bundle.events].sort((a, b) => a.seq - b.seq);
  for (const ev of orderedEvents) {
    if (ev.prevHash !== expectedPrev) {
      errors.push(
        `Event seq=${ev.seq} prevHash mismatch (expected ${expectedPrev.slice(0, 12)}, got ${ev.prevHash.slice(0, 12)})`,
      );
    }
    const recomputed = computeEventHash(
      ev.prevHash,
      ev.eventType,
      ev.actor,
      ev.payloadJson,
    );
    if (ev.eventHash !== recomputed) {
      errors.push(`Event seq=${ev.seq} hash tamper detected`);
    }
    expectedPrev = ev.eventHash;
  }

  const {bundleSha256: actualDigest, ...unsigned} = bundle;
  const expectedDigest = sha256Canonical(unsigned);
  if (actualDigest !== expectedDigest) {
    errors.push('EvidenceBundle SHA-256 digest mismatch');
  }

  return {
    valid: errors.length === 0,
    checkedEvents: orderedEvents.length,
    errors,
  };
}
