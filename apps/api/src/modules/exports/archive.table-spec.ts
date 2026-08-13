/**
 * archive.table-spec.ts — the vocabulary an archived table is declared in.
 *
 * Types only. The 41 declarations themselves live in `archive.tables.ts`, and
 * `archive.service.ts` reads both. Split the way `subject-export.reach.ts` and
 * `subject-export.tables.ts` are split, for the same reason: the grammar and
 * the data rot at different rates, and a reader arriving at one rarely wants
 * the other.
 */

/** One row of one table, as it travels in an archive file. */
export type ArchiveRow = Record<string, unknown>;

/**
 * The id maps a restore threads through `remapRow`.
 *
 * A NAMED map exists for one reason only: some OTHER table's foreign key points
 * at this table's id, so the new id has to be reachable by name while that
 * other table is being rewritten. Everything else falls back to a lazily
 * created per-table map (`generic`) — every id-bearing row still gets a fresh
 * id, it just does not need to be found again.
 *
 * `fighters` is the odd one out: no archived table's primary key maps through
 * it. It exists because `global_person_id` columns point at `global_persons`,
 * which is NOT archived — the map stays empty and those ids pass through, which
 * is exactly right for a reference to something outside the archive.
 */
export const ID_MAP_NAMES = [
  'events',
  'themes',
  'lices',
  'persons',
  'fighters',
  'tournaments',
  'registrations',
  'phases',
  'pools',
  'bracketSlots',
  'swissRounds',
  'matches',
  // A correction points at the exchange it replaced, so exchanges need to be
  // findable by name. Before the registry this one resolved through the generic
  // per-table map instead — the same map, reached the long way round.
  'exchanges',
  'workshops',
  'workshopSessions',
  'refereeSkills',
  'matchForfeits',
  'matchPenalties',
  'tournamentSlotConfig',
  'eventSlotConfig',
] as const;

export type IdMapName = (typeof ID_MAP_NAMES)[number];

/**
 * A FK column swept on every table: the id map that resolves it, and which
 * restore target an unmapped value falls back to.
 */
export interface SharedFkColumn {
  readonly map: IdMapName;
  readonly target?: 'event' | 'tournament';
}

export interface JsonIdPath {
  readonly path: string;
  readonly map: IdMapName;
}

/**
 * Where a table's rows come from.
 *
 *   { from: 'root' }                      the row(s) the caller already holds
 *   { from: 'event' }                     eq('event_id', the event being archived)
 *   { from: T, local, parent? }           in(local, the values of `parent` — 'id'
 *                                         unless stated — on T's collected rows)
 *
 * Resolution is on demand and memoised, NOT in declaration order, because no
 * single order can serve both collection and insertion: `registrations.person_id`
 * means persons must be INSERTED first, while a tournament-scope archive finds
 * its persons THROUGH the registrations. Declaration order is the insert order;
 * collection follows these edges wherever they lead.
 */
export type CollectRule = {
  readonly from: string;
  /** The column on THIS table that holds the parent's value. */
  readonly local?: string;
  /** The column on the PARENT whose values `local` matches. Defaults to `id`. */
  readonly parent?: string;
  /** Collected only in a `scoring` archive; a structure-only one leaves it empty. */
  readonly include?: 'scoring';
  /**
   * Narrow the rows after fetching. Two tables need it, both only in tournament
   * scope, where an event-wide query has to be cut down to one tournament's
   * share. Anything the predicate reads must be named in `needs`.
   */
  readonly filter?: (row: ArchiveRow, ctx: CollectContext) => boolean;
  /** Tables to resolve before `filter` runs. */
  readonly needs?: readonly string[];
};

export interface CollectContext {
  readonly eventId: string;
  readonly tournamentIds: readonly string[];
  /** The `id`s of an already-resolved table. Only valid for a table in `needs`. */
  idsOf(table: string): readonly string[];
}

/** A table not carried at all in this scope. */
export type CollectOmitted = 'omit';

/**
 * One archived table, declared once.
 *
 * Everything the archive knows about a table is here: what it is called in the
 * envelope, which id map its primary key uses, and which ids hide inside its
 * JSON columns. Adding a table used to mean finding six declarations and
 * remembering all six; two of them failed SILENTLY when missed — the table was
 * exported and never restored, or collected as an empty array — because nothing
 * cross-checked one list against another.
 *
 * `key` is required and unique. Every other field defaults to doing nothing,
 * which is the safe default for each of them.
 */
export interface ArchiveTableSpec {
  /**
   * The camelCase member this table occupies in the archive envelope
   * (`MyClashArchive['data']`). It is the wire format: renaming one breaks
   * every archive file already written.
   */
  readonly key: string;

  /**
   * How the table is gathered, per archive scope.
   *
   * An EVENT archive takes the whole event. A TOURNAMENT archive takes one
   * competition out of it, so most event-level rosters and settings are `omit`
   * there — that is a judgement about what a tournament copy IS, and it belongs
   * on the table rather than in the shape of a method.
   */
  readonly collect: {
    readonly event: CollectRule | CollectOmitted;
    readonly tournament: CollectRule | CollectOmitted;
  };

  /**
   * The named id map this table's primary key is remapped through. Omit unless
   * another table's FK column names this table — see `ID_MAP_NAMES`.
   */
  readonly idMap?: IdMapName;

  /**
   * Ids that live INSIDE a JSON column.
   *
   * `remapRow`'s column sweep goes through `mapFk`, which returns early on
   * anything that is not a top-level string. So an id nested in an array or an
   * object survives a restore verbatim and keeps pointing into the SOURCE
   * event — a copy that is supposed to be self-contained silently is not.
   *
   * Path grammar, deliberately smaller than JSON Pointer: dotted keys, and `[]`
   * for "every element of this array". `a.b[]` is every element of the array at
   * `a.b`; `a[].b` is the `b` of every element of `a`. No wildcards and no
   * escapes — every path is a literal shape some service writes, so a path that
   * stops matching must read as a mistake, not quietly match something else.
   *
   * A path that matches nothing is a no-op, and an id with no entry in its map
   * is left alone: that is how a reference to something outside the archive
   * survives instead of becoming undefined.
   */
  readonly json?: readonly JsonIdPath[];

  /**
   * FK columns this table carries that the shared sweep does not know about,
   * mapped to the id map that resolves them. Two kinds land here: a
   * self-reference (`exchanges.corrected_exchange_id`,
   * `match_forfeits.parent_forfeit_id`) and a column whose name is ambiguous
   * across tables (`slot_config_id` means the event config on one table and the
   * tournament config on another).
   */
  readonly fk?: Readonly<Record<string, IdMapName>>;

  /**
   * Columns holding a `referee_skills.id`. System skills are shared across every
   * event and pass through; a custom skill is event-scoped and is remapped.
   * `referee_assignments.role` is one of these — the column name says role, the
   * value is a skill id.
   */
  readonly skillIdColumns?: readonly string[];

  /** Columns overwritten with a literal on restore, whatever the source held. */
  readonly set?: Readonly<Record<string, unknown>>;

  /** Mint a new `client_uuid` — the offline pad's idempotency key, never shared. */
  readonly freshClientUuid?: boolean;

  /**
   * What to do when the copy lands in a DIFFERENT organization from the source.
   *
   * Org-level catalogues — venues, penalty rulesets, compensation plans — are
   * referenced by id and never copied, so across orgs they resolve to nothing.
   * `'drop'` for a row that cannot exist without one (a NOT NULL reference);
   * `{ null: [...] }` for nullable columns the row survives without.
   */
  readonly crossOrg?: 'drop' | { readonly null: readonly string[] };
}
