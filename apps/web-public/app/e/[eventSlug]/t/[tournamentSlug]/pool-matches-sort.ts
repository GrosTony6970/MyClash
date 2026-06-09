/**
 * Natural ("human") string comparison so pool-match round codes order
 * M1, M2, … M10, … M28 rather than the lexicographic M1, M10, M2, …
 * Splits each string into alternating non-digit / digit chunks and
 * compares digit chunks numerically. Dependency-free + pure so it can
 * be unit-tested and used as an `Array.prototype.sort` comparator.
 */
export function naturalCompare(a: string, b: string): number {
  const chunk = (s: string): Array<string | number> =>
    (s.match(/\d+|\D+/gu) ?? []).map((part) => (/^\d+$/u.test(part) ? Number(part) : part));

  const ax = chunk(a);
  const bx = chunk(b);
  const len = Math.min(ax.length, bx.length);

  for (let i = 0; i < len; i += 1) {
    const av = ax[i]!;
    const bv = bx[i]!;
    if (av === bv) continue;
    // Numbers sort before strings at the same position, then by value.
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    if (typeof av === 'number') return -1;
    if (typeof bv === 'number') return 1;
    return av < bv ? -1 : 1;
  }
  return ax.length - bx.length;
}
