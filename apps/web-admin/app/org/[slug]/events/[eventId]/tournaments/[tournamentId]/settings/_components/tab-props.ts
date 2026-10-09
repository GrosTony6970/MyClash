/** What the settings page hands each of its tabs, and its drift banner. */
export interface TabProps {
  tournamentId: string;
  /**
   * The Event is archived: the server refuses this tab's saves, so the tab still
   * shows what was set and closes the buttons that save it (ruling 377).
   */
  readOnly: boolean;
}
