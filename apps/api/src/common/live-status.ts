/**
 * Is the Event or Tournament public and not over: published or running? Going there is news: an
 * announcement, the lock messages. Completed and archived are old news (rulings 189, 190, 191, 193).
 */
export const isLive = (status: unknown): boolean => status === 'published' || status === 'running';

/**
 * Is the Event over: completed or archived? Nothing waits in one that is: no alert is looked for
 * there. An assumption that bounds the work to the Events still to come, not a check.
 */
export const isOver = (status: unknown): boolean => status === 'completed' || status === 'archived';
