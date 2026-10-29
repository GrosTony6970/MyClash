/**
 * Every audited rules change of a Tournament, as its PUBLIC page discloses it (operator rulings
 * "Public notice", "Version notice", "Private formula"): newest first, each with its kind, both
 * pairs by name and version, the reason, the date and what changed.
 *
 * Read server-side (service role): the record table is not anon-readable, so the API is the
 * disclosure surface. What a club wrote as its formula is its own: when either side of a change
 * is not a built-in, the formula paths carry no value. The projection is an ALLOW-list: a value
 * crosses only on a listed path that is not, on such a change, a formula path; `unknown`,
 * `forfeitRules.unknown` and any path this build does not list cross as a path alone. A forfeit
 * rule's values are rules, not a club's formula: they cross (ruling 145), and no Fighter is named.
 */
import type { Logger } from '@nestjs/common';
import type { RulesetRegistry } from '@myclash/rulesets';
import {
  FORFEIT_UNKNOWN_PATH,
  FORMULA_STRUCTURE_PATHS,
  RULES_CHANGE_PATHS,
  type RulesChange,
  type RulesChangeNotice,
  type RulesChangePath,
} from '@myclash/types';
import type { SupabaseService } from '../supabase/supabase.service';
import { normalizeRulesetVersion, resolveRulesetLabel } from './ruleset-defaults';

/** The columns the notice reads, and nothing more: no placings, no actor, no settings. */
export const RULES_CHANGE_NOTICE_COLUMNS =
  'kind, from_code, from_version, to_code, to_version, justification, changes, created_at';

interface NoticeRow {
  kind: 'ruleset' | 'settings';
  from_code: string;
  from_version: string;
  to_code: string;
  to_version: string;
  justification: string;
  changes: unknown;
  created_at: string;
}

const LISTED: ReadonlySet<string> = new Set(RULES_CHANGE_PATHS);

/** Listed paths that carry no value anywhere, whatever the record holds. */
const PATH_ONLY_PATHS: ReadonlySet<string> = new Set([FORFEIT_UNKNOWN_PATH]);

/** Whether a change touches a club ruleset: a code the registry does not hold, read from nowhere. */
function isPrivateFormula(registry: RulesetRegistry, row: NoticeRow): boolean {
  return [row.from_code, row.to_code].some((code) => registry.latestVersionOf(code) === undefined);
}

/** One recorded change as the public may see it. */
export function publicChange(change: RulesChange, privateFormula: boolean): RulesChange {
  const path = change.path as string;
  const showsValues =
    LISTED.has(path) &&
    !PATH_ONLY_PATHS.has(path) &&
    !(privateFormula && FORMULA_STRUCTURE_PATHS.has(change.path as RulesChangePath));
  // Ruling 147's mark, by an allow-list of its two values: never a value the record holds.
  const stored = change.stored === 'set' || change.stored === 'reset' ? change.stored : null;
  return {
    path: LISTED.has(path) ? change.path : 'unknown',
    before: showsValues ? change.before : null,
    after: showsValues ? change.after : null,
    ...(change.locked === undefined ? {} : { locked: change.locked }),
    ...(stored && showsValues ? { stored } : {}),
  };
}

/** A record's changes for the public: a record that holds no list holds no change. */
function publicChanges(changes: unknown, privateFormula: boolean): RulesChange[] {
  return Array.isArray(changes)
    ? (changes as RulesChange[]).map((change) => publicChange(change, privateFormula))
    : [];
}

/**
 * The notices of a Tournament, newest first. A failed read is logged and answers none: a notice
 * must not take the public page down, and the log is the trace. Each distinct pair is named once.
 */
export async function loadRulesetRepins(
  deps: { supabase: SupabaseService; registry: RulesetRegistry; logger: Logger },
  tournamentId: string,
): Promise<RulesChangeNotice[]> {
  const { data, error } = await deps.supabase.service
    .from('tournament_ruleset_repins')
    .select(RULES_CHANGE_NOTICE_COLUMNS)
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) {
    deps.logger.warn(
      `The rules changes of Tournament ${tournamentId} were not read: ${error.message}`,
    );
    return [];
  }
  const rows = (data ?? []) as NoticeRow[];
  const labels = new Map<string, Promise<string>>();
  const labelOf = (code: string, version: string): Promise<string> => {
    const key = `${code}@${version}`;
    const label =
      labels.get(key) ?? resolveRulesetLabel(deps.supabase, deps.registry, code, version);
    labels.set(key, label);
    return label;
  };
  return Promise.all(rows.map((row) => noticeOf(row, deps.registry, labelOf)));
}

async function noticeOf(
  row: NoticeRow,
  registry: RulesetRegistry,
  labelOf: (code: string, version: string) => Promise<string>,
): Promise<RulesChangeNotice> {
  const fromVersion = normalizeRulesetVersion(row.from_version);
  const toVersion = normalizeRulesetVersion(row.to_version);
  const privateFormula = isPrivateFormula(registry, row);
  return {
    kind: row.kind,
    changedAt: row.created_at,
    sameRuleset: row.from_code === row.to_code,
    fromLabel: await labelOf(row.from_code, fromVersion),
    fromVersion,
    toLabel: await labelOf(row.to_code, toVersion),
    toVersion,
    justification: row.justification,
    changes: publicChanges(row.changes, privateFormula),
    privateFormula,
  };
}
