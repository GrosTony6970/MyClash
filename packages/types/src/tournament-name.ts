/** A name as compared: one Unicode form, trimmed, runs of whitespace as one space, lower case. */
function comparableName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether a typed name is the Tournament's name (operator ruling "Typed name"): case and runs of
 * whitespace do not count, accents do ('Épée Dames' is not 'Epee dames'). The dialog's confirm
 * button and the server both ask this, so they never disagree.
 *
 * `toLowerCase`, not `toLocaleLowerCase`: the locale form depends on the machine (a Turkish
 * browser lowers 'I' to a dotless 'ı'), and the server and the browser must give one answer.
 * NFC first: an 'É' typed as 'E' plus a combining accent is the same name.
 */
export function sameTournamentName(a: string, b: string): boolean {
  return comparableName(a) === comparableName(b);
}
