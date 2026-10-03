/**
 * Is the Event or Tournament public and not over: published or running? Going there is news: an
 * announcement, the lock messages. Completed and archived are old news (rulings 189, 190, 191, 193).
 */
export const isLive = (status: unknown): boolean => status === 'published' || status === 'running';

/**
 * Is the Event over: completed or archived? Nothing waits in one that is: no alert is looked for
 * there, an assumption that bounds the work to the Events still to come. And its results are
 * frozen where `FrozenResultsGuard` is asked: an Exchange's void and a forfeit's go through a
 * super admin (ruling 222a), an Exchange edit and a penalty void are a super admin's (ruling
 * 231). A penalty review does not ask.
 */
export const isOver = (status: unknown): boolean => status === 'completed' || status === 'archived';
