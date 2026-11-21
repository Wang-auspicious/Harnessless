/**
 * Typed domain errors and exhaustiveness guard for ForgeOps boundaries.
 */

export type ForgeErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_PATH'
  | 'POLICY_DENIED'
  | 'DDD_DRIFT_DETECTED'
  | 'DAG_CYCLE'
  | 'ADAPTER_UNAVAILABLE'
  | 'GATE_FAILED'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MIGRATION_ERROR'
  | 'SETUP_REQUIRED'
  | 'BUDGET_EXCEEDED'
  | 'STALE_EPOCH'
  | 'ABORTED'
  | 'INTERNAL_ERROR';

export class ForgeError extends Error {
  readonly code: ForgeErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ForgeErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ForgeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertNever(value: never, label = 'Unhandled variant'): never {
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
