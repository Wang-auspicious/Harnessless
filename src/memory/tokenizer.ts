const CJK_RANGE = /[\u4e00-\u9fff]/;

function splitIdentifierSubtokens(word: string): string[] {
  const parts = word
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ')
    .split(/\s+/)
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);
  return parts;
}

export function tokenizeBilingual(text: string): string[] {
  const out: string[] = [];
  const rawSegments = text.match(/[A-Za-z0-9_.-]+|[\u4e00-\u9fff]+/g);
  if (!rawSegments) {
    return out;
  }

  for (const seg of rawSegments) {
    if (CJK_RANGE.test(seg)) {
      if (seg.length === 1) {
        out.push(seg);
      } else {
        for (let i = 0; i < seg.length - 1; i += 1) {
          out.push(seg.slice(i, i + 2));
        }
      }
      continue;
    }

    const lower = seg.toLowerCase();
    if (lower.length >= 2) {
      out.push(lower);
    }
    const sub = splitIdentifierSubtokens(seg);
    for (const part of sub) {
      if (part.length >= 2 && part !== lower) {
        out.push(part);
      }
    }
  }
  return out;
}

export function buildFtsTokens(text: string): string {
  return tokenizeBilingual(text).join(' ');
}

export function buildFtsMatchQuery(rawQuery: string): string {
  const unique = Array.from(
    new Set(
      tokenizeBilingual(rawQuery)
        .map(tok => tok.replace(/"/g, '').trim())
        .filter(tok => tok.length > 0),
    ),
  ).slice(0, 24);
  if (unique.length === 0) {
    return '';
  }
  return unique.map(tok => `"${tok}"`).join(' OR ');
}

export function canonicalEntityKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\-\s./]+/g, '');
}
