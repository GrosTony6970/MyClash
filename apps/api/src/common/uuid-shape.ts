/**
 * A uuid of any version, as Postgres's `uuid` type and `ParseUUIDPipe` read one: the shape only,
 * no RFC 4122 version or variant nibbles (`event-ref.ts` keeps its stricter RFC rule on purpose).
 *
 * The shared copy; older copies of the same regex remain at `fighters/fighters.service.ts`,
 * `photos/photo-upload.service.ts`, `programme/programme.service.ts` and
 * `schedule/live-state.service.ts`. A value that fails it never reaches a `uuid` column's
 * filter: Postgres refuses the whole read (22P02) for one bad value, so a caller that names rows
 * by ids it did not validate (a model's tool arguments, an audit payload) asks this first.
 */
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const UUID_SHAPE = new RegExp(`^${UUID_BODY}$`, 'i');

/** The same shape anywhere in a text: `Sabre Open 3f2a…` holds one. */
const UUID_INSIDE = new RegExp(UUID_BODY, 'i');

/** Whether `value` is a uuid-shaped string. */
export function isUuidShape(value: unknown): value is string {
  return typeof value === 'string' && UUID_SHAPE.test(value);
}

/** Whether `value` is a string that holds a uuid shape anywhere in it. */
export function containsUuidShape(value: unknown): boolean {
  return typeof value === 'string' && UUID_INSIDE.test(value);
}
