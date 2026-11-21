import {extractBalancedJsonObject} from '../shared/validation.ts';

export interface Schema<T> {
  readonly json: Record<string, unknown>;
  parse(value: unknown, path?: string): T;
}

export type Validated<S> = S extends Schema<infer T> ? T : never;

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

function makeSchema<T>(
  json: Record<string, unknown>,
  parse: (value: unknown, path: string) => T,
): Schema<T> {
  return {
    json,
    parse: (value, path = '$') => parse(value, path),
  };
}

function fail(path: string, expectation: string): never {
  throw new SchemaError(`${path}: ${expectation}`);
}

export function dslString(
  max = 3000,
  min = 1,
  pattern?: RegExp,
): Schema<string> {
  return makeSchema(
    {
      type: 'string',
      maxLength: max,
      minLength: min,
      ...(pattern ? {pattern: pattern.source} : {}),
    },
    (value, path) => {
      if (typeof value !== 'string') {
        return fail(path, 'expected string');
      }
      const trimmed = value.trim();
      if (
        value.length > max ||
        trimmed.length < min ||
        (pattern && !pattern.test(trimmed))
      ) {
        return fail(path, `invalid text length (${min}..${max}) or format`);
      }
      return trimmed;
    },
  );
}

export function dslInteger(min: number, max: number): Schema<number> {
  return makeSchema(
    {type: 'integer', minimum: min, maximum: max},
    (value, path) => {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < min ||
        value > max
      ) {
        return fail(path, `expected integer between ${min} and ${max}`);
      }
      return value;
    },
  );
}

export function dslNumber(min = 0, max = 1): Schema<number> {
  return makeSchema(
    {type: 'number', minimum: min, maximum: max},
    (value, path) => {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      ) {
        return fail(path, `expected finite number between ${min} and ${max}`);
      }
      return value;
    },
  );
}

export function dslChoice<const T extends readonly string[]>(
  ...values: T
): Schema<T[number]> {
  return makeSchema({enum: values}, (value, path) => {
    if (typeof value !== 'string' || !values.includes(value)) {
      return fail(path, `expected one of ${values.join(' | ')}`);
    }
    return value as T[number];
  });
}

export const dslBoolean: Schema<boolean> = makeSchema(
  {type: 'boolean'},
  (value, path) => {
    if (typeof value !== 'boolean') {
      return fail(path, 'expected boolean');
    }
    return value;
  },
);

export function dslArray<T>(item: Schema<T>, min = 0, max = 36): Schema<T[]> {
  return makeSchema(
    {type: 'array', items: item.json, minItems: min, maxItems: max},
    (value, path) => {
      if (!Array.isArray(value) || value.length < min || value.length > max) {
        return fail(path, `expected array of ${min}..${max} items`);
      }
      return value.map((entry, idx) => item.parse(entry, `${path}[${idx}]`));
    },
  );
}

export function dslOptional<T>(inner: Schema<T>): Schema<T | undefined> {
  return makeSchema(inner.json, (value, path) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    return inner.parse(value, path);
  });
}

type ObjectResult<
  T extends Record<string, Schema<unknown>>,
  Opt extends keyof T,
> = {[K in Exclude<keyof T, Opt>]: Validated<T[K]>} & {
  [K in Opt]?: Validated<T[K]>;
};

export function dslObject<
  T extends Record<string, Schema<unknown>>,
  const Opt extends keyof T = never,
>(shape: T, optionalKeys: readonly Opt[] = []): Schema<ObjectResult<T, Opt>> {
  const optSet = new Set<string>(optionalKeys.map(k => String(k)));
  const fields = Object.entries(shape);
  const required = fields.map(([k]) => k).filter(k => !optSet.has(k));

  return makeSchema(
    {
      type: 'object',
      additionalProperties: false,
      required,
      properties: Object.fromEntries(fields.map(([k, f]) => [k, f.json])),
    },
    (value, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fail(path, 'expected object');
      }
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(shape, key)) {
          return fail(path, `unexpected property "${key}"`);
        }
      }
      const out: Record<string, unknown> = {};
      for (const [key, field] of fields) {
        const parsedVal = field.parse(record[key], `${path}.${key}`);
        if (!optSet.has(key) || parsedVal !== undefined) {
          out[key] = parsedVal;
        }
      }
      return out as ObjectResult<T, Opt>;
    },
  );
}

export const dslIdentifier = dslString(80, 1, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

export function extractJsonPayload<T>(rawText: string, schema: Schema<T>): T {
  const candidate = extractBalancedJsonObject(rawText);
  if (!candidate) {
    throw new SchemaError('Response did not contain a valid JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SchemaError(`Malformed JSON object: ${msg}`);
  }
  return schema.parse(parsed);
}
