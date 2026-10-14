/**
 * Prints `html` in a window of its own. ONE owner of a page's "Print / PDF": four of
 * the five doors returned in silence when a pop-up blocker refused the window
 * (quick win O21), and the organiser thought print was broken at the awards.
 * `onBlocked` is required, so a door cannot forget that case; it is told when the
 * browser refused the window (the shared words: `organizer.printWindow.popupBlocked`).
 */
export function openPrintWindow(html: string, onBlocked: () => void): void {
  const w = window.open('', '_blank');
  if (!w) {
    onBlocked();
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
