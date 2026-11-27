/**
 * A uuid of any version, as Postgres's `uuid` type and `ParseUUIDPipe` read one: the shape only,
 * no RFC 4122 version or variant nibbles (`event-ref.ts` keeps its stricter RFC rule on purpose).
 *
 * The one copy. A value that fails it never reaches a `uuid` column's filter: Postgres refuses
 * the whole read (22P02) for one bad value, so a caller that names rows by ids it did not
 * validate (a model's tool arguments, an audit payload) asks this first.
 */
export const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a uuid-shaped string. */
export function isUuidShape(value: unknown): value is string {
  return typeof value === 'string' && UUID_SHAPE.test(value);
}
