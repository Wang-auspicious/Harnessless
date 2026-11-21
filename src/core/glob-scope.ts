export function normalizeRepoPath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
}

function globToRegExp(pattern: string): RegExp {
  let normalized = normalizeRepoPath(pattern);
  if (normalized.endsWith('/')) {
    normalized += '**';
  }
  let regexStr = '^';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i]!;
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
          continue;
        }
        regexStr += '.*';
        i += 2;
        continue;
      }
      regexStr += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      regexStr += '[^/]';
      i += 1;
      continue;
    }
    regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  regexStr += '$';
  return new RegExp(regexStr, 'i');
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  const cleanFile = normalizeRepoPath(filePath);
  const cleanPattern = normalizeRepoPath(pattern);
  if (!cleanPattern) {
    return false;
  }
  if (!/[*?]/.test(cleanPattern)) {
    const dirPrefix = cleanPattern.endsWith('/')
      ? cleanPattern
      : `${cleanPattern}/`;
    return (
      cleanFile.toLowerCase() === cleanPattern.toLowerCase() ||
      cleanFile.toLowerCase().startsWith(dirPrefix.toLowerCase())
    );
  }
  return globToRegExp(cleanPattern).test(cleanFile);
}

export function isFileInsideScope(
  filePath: string,
  fileScope: readonly string[],
): boolean {
  const clean = normalizeRepoPath(filePath);
  if (
    !clean ||
    clean === '.git' ||
    clean.startsWith('.git/') ||
    clean.includes('/.git/')
  ) {
    return false;
  }
  if (fileScope.length === 0) {
    return true;
  }
  return fileScope.some(pattern => matchesGlob(clean, pattern));
}

function staticPrefixOf(pattern: string): string {
  const clean = normalizeRepoPath(pattern);
  const wildcardIdx = clean.search(/[*?]/);
  const head = wildcardIdx >= 0 ? clean.slice(0, wildcardIdx) : clean;
  return head.replace(/\/+$/, '').toLowerCase();
}

export function scopesOverlap(
  scopeA: readonly string[],
  scopeB: readonly string[],
): boolean {
  if (scopeA.length === 0 || scopeB.length === 0) {
    return true;
  }
  for (const a of scopeA) {
    const cleanA = normalizeRepoPath(a);
    if (cleanA === '**' || cleanA === '*') {
      return true;
    }
    for (const b of scopeB) {
      const cleanB = normalizeRepoPath(b);
      if (cleanB === '**' || cleanB === '*') {
        return true;
      }
      if (matchesGlob(cleanA, cleanB) || matchesGlob(cleanB, cleanA)) {
        return true;
      }
      const prefA = staticPrefixOf(cleanA);
      const prefB = staticPrefixOf(cleanB);
      if (!prefA || !prefB) {
        return true;
      }
      if (
        prefA === prefB ||
        prefA.startsWith(`${prefB}/`) ||
        prefB.startsWith(`${prefA}/`)
      ) {
        return true;
      }
    }
  }
  return false;
}
