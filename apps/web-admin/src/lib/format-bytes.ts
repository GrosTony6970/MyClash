/**
 * Binary byte sizes for the platform-health surfaces: "18 GB", "1.5 GB", "512 MB".
 *
 * One owner for the two cards on /admin/system-versions that sit one above the
 * other — the host card's total disk and the runtime-health card's free disk are
 * the same quantity seen from two sides, and two formatters would eventually
 * disagree about the digit an operator compares them by.
 *
 * Units stay as the unlocalised symbols the rest of that page already uses.
 * Translating only this card to "Go" would leave the two stacked panels
 * disagreeing on screen, which is worse than either choice applied consistently.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
