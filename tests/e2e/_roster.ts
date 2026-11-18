/**
 * A roster CSV made safe to import on a real stack: no row but the ones named
 * can reach a real person.
 *
 * Importing a roster sends nothing itself, but each row is matched to an
 * existing global profile by HEMA Ratings id, by name + club, or by email
 * (`global-person-resolver.service.ts`), and a row whose address matches the
 * profile's account is claimed for that account at once. From then on that real
 * person gets the demo's duty, bout, Workshop and results notices, their
 * followers get its alerts, and the real address on the roster row can be
 * mailed by a broadcast, a Workshop notice, the pass mail-out or a claim link.
 *
 * So every row NOT named in `linked` loses the three things a match is made on:
 * `email`, `hema_ratings_id`, and the club (`club`, `club_abv`, `club_city` —
 * clubs are found by fuzzy name, so a renamed club could still match). Such a
 * row can only mint a fresh profile with no account and no address.
 *
 * `linked` names people, as "Given Family", who agreed to be linked and to get
 * the demo's notices. Each must match exactly one row, or this throws: a typo
 * must not silently isolate someone, nor link two people of one name.
 */
const CONTACT_COLUMNS = ['email', 'hema_ratings_id', 'club', 'club_abv', 'club_city'] as const;

const fold = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The names in `E2E_POPULATE_LINKED`: "Given Family" entries, separated by `;`. */
export function linkedNames(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function isolateRoster(
  csv: string,
  linked: readonly string[],
): { csv: string; isolated: number; kept: number } {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const header = lines[0] ?? '';
  // The importer auto-detects `;` or `,`. Quoted cells are refused rather than
  // mis-split: a shifted column would blank the wrong field and keep an address.
  const delimiter = header.includes(';') ? ';' : ',';
  if (lines.some((line) => line.includes('"'))) {
    throw new Error('[e2e] isolateRoster reads unquoted CSV only; this roster has quoted cells');
  }
  const columns = header.split(delimiter).map((c) => c.trim().toLowerCase());
  const at = (name: string) => columns.indexOf(name);
  const given = at('given_name');
  const family = at('family_name');
  if (given < 0 || family < 0) throw new Error('[e2e] roster has no given_name/family_name');
  const blanks = CONTACT_COLUMNS.map(at).filter((index) => index >= 0);

  const wanted = new Map(linked.map((name) => [fold(name), 0]));
  let isolated = 0;
  const out = [header];
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const cells = line.split(delimiter);
    const name = fold(`${cells[given] ?? ''} ${cells[family] ?? ''}`);
    if (wanted.has(name)) {
      wanted.set(name, wanted.get(name)! + 1);
    } else {
      for (const index of blanks) if (index < cells.length) cells[index] = '';
      isolated++;
    }
    out.push(cells.join(delimiter));
  }

  const wrong = [...wanted].filter(([, count]) => count !== 1);
  if (wrong.length > 0) {
    throw new Error(
      `[e2e] E2E_POPULATE_LINKED must name people found exactly once in the roster: ` +
        wrong.map(([name, count]) => `"${name}" × ${count}`).join(', '),
    );
  }
  return { csv: `${out.join('\n')}\n`, isolated, kept: linked.length };
}
