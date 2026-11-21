import {tokenizeBilingual} from './tokenizer.ts';

export const LOCAL_EMBEDDING_SPACE = 'local-rp-128';
export const LOCAL_EMBEDDING_DIMS = 128;

function fnv1a32(str: string, seed = 2166136261): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function normalizeL2(vec: Float32Array): Float32Array {
  let normSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const v = vec[i]!;
    normSq += v * v;
  }
  if (normSq <= 0) {
    return vec;
  }
  const inv = 1 / Math.sqrt(normSq);
  for (let i = 0; i < vec.length; i += 1) {
    vec[i] = vec[i]! * inv;
  }
  return vec;
}

export function embedTextLocal(
  text: string,
  dims = LOCAL_EMBEDDING_DIMS,
): Float32Array {
  const vec = new Float32Array(dims);
  const tokens = tokenizeBilingual(text);

  for (const tok of tokens) {
    const idx = fnv1a32(tok, 2166136261) % dims;
    const sign = (fnv1a32(tok, 16777619) & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * 1.5;

    if (tok.length >= 3) {
      for (let i = 0; i <= tok.length - 3; i += 1) {
        const gram = tok.slice(i, i + 3);
        const gIdx = fnv1a32(gram, 374761393) % dims;
        const gSign = (fnv1a32(gram, 668265263) & 1) === 0 ? 1 : -1;
        vec[gIdx] = (vec[gIdx] ?? 0) + gSign * 0.5;
      }
    }
  }

  return normalizeL2(vec);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA <= 0 || normB <= 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function encodeFloat32Blob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function decodeFloat32Blob(
  blob: Uint8Array,
  dims: number,
): Float32Array {
  const copy = new Uint8Array(blob);
  const view = new Float32Array(
    copy.buffer,
    copy.byteOffset,
    Math.floor(copy.byteLength / 4),
  );
  if (view.length === dims) {
    return view;
  }
  const out = new Float32Array(dims);
  out.set(view.subarray(0, dims));
  return out;
}
