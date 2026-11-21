import type {DatabaseSync} from 'node:sqlite';

export type SqlRow = Record<string, unknown>;

export interface StoreContext {
  readonly db: DatabaseSync;
  atomic<T>(fn: () => T extends PromiseLike<unknown> ? never : T): T;
  afterCommit(cb: () => void): void;
  nextSequence(key: string): number;
}

export function str(row: SqlRow, key: string): string {
  const v = row[key];
  return typeof v === 'string'
    ? v
    : v === null || v === undefined
      ? ''
      : String(v);
}

export function nullableStr(row: SqlRow, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' ? v : null;
}

export function num(row: SqlRow, key: string): number {
  const v = row[key];
  return typeof v === 'number' ? v : Number(v ?? 0);
}

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
