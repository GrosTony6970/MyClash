/**
 * A finished bout the doubles limit ended as a loss for BOTH fighters.
 *
 * The server says so in the bout's end reason: `'max_doubles'`, and only that
 * value (`isDoubleLossBout` in `@myclash/rules`; the TV scoreboard reads the
 * same). The other two outcomes of the limit are a draw and a result that
 * stands, and a best-of bout whose last round met the limit can have a winner.
 *
 * It read the pad's own doubles count against the limit. That count is of the
 * open round and holds the tablet's unsent hits, and the limit depends on a
 * phase the pad may not have read: none of it says how a bout ended.
 *
 * One reason is the tablet's own: the one an "End match" at the doubles limit
 * carries while the server has not confirmed it (`pressedOn`), for the result
 * screen. It is decided at the tap by the server's function, not by a count
 * read at render.
 */
export function isDoubleLoss(matchStatus: string, endReason: string | null | undefined): boolean {
  return matchStatus === 'completed' && endReason === 'max_doubles';
}
