/**
 * The Workshop statuses the public sees (migration 0100; mirrors `PUBLIC_TOURNAMENT_STATUSES`):
 * a draft Workshop is the organiser's alone. A leaf, so a worker can read it without importing
 * the Workshops service (which imports the follow alerts' scheduler).
 */
export const PUBLIC_WORKSHOP_STATUSES = ['published', 'running', 'completed'];
