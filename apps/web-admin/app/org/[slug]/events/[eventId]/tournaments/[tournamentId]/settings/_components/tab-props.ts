/** What the settings page hands each of its tabs, and its drift banner. */
export interface TabProps {
  tournamentId: string;
  /**
   * The server refuses this tab's saves: the Event is archived (ruling 377), or the reader is
   * below admin in its club (ruling 101). The tab still shows what was set and closes the buttons
   * that save it.
   */
  readOnly: boolean;
  /** Why, the sentence each closed Save carries; undefined while the saves are open. */
  readOnlyWhy: string | undefined;
  /** The tab holds edits not saved yet (O15): the page asks before they are lost. */
  onDirtyChange?: (dirty: boolean) => void;
  /** A save wrote the Tournament's rules: the drift banner reads again (revision 10 fold 7). */
  onRulesSaved?: () => void;
  /** How many rules saves the page has seen: the drift banner reads again on each. */
  rulesSavedAt?: number;
}
