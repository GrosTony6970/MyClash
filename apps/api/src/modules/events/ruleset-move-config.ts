/**
 * The rules a Tournament holds after its ruleset pair moves: the one owner for
 * the PATCH that swaps the pair before any result, the audited re-pin and its
 * preview.
 *
 * Operator ruling "A version move" (2026-10-17): a Tournament on TF_v1 1.0.0
 * with a cap of 7 that moves to 1.1.0 keeps its cap. A built-in's versions
 * differ in the end decision only and share their settings, so a move between
 * them keeps the stored settings. A club ruleset's version IS its content (a
 * new cap, a new formula), so a move to another of its versions takes that
 * version's settings, as a move to another code always did (ruling "Club
 * version", 2026-10-18). A caller's own patch, sent with the move, goes on top
 * of either. A stored row is fully parsed, so its keys win; the defaults fill
 * only what a stored row lacks (an empty or a legacy row). A club formula
 * stores only its own seed and the patch (ruling "Club move", 2026-10-20).
 *
 * The buttons follow the same rule (operator ruling "Draft switch",
 * 2026-10-19): a move that takes the new pair's settings also takes its buttons
 * and afterblow mode, seeded as a new Tournament's are; the display (side
 * colours, quick penalties) is the organiser's and stays. A built-in's other
 * version keeps them.
 */
import { normalizeMatchFormatConfig, type RulesetRegistry } from '@myclash/rulesets';
import type { TournamentScoringConfig } from '@myclash/types';
import { disqualifyAfterOf } from '@myclash/types/effective-rules';
import type { SupabaseService } from '../supabase/supabase.service';
import { deepMergeJson } from '../../common/deep-merge';
import { scoringKindOf, type ScoringStructure } from '../ruleset-hash/scoring-structure';
import {
  buildSeededScoringConfig,
  isSystemRuleset,
  resolveRulesetConfigDefaults,
  resolveRulesetGrammar,
} from './ruleset-defaults';
import {
  inEngineWords,
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';

type Settings = Record<string, unknown>;

const objectOr = (value: unknown): Settings =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Settings) : {};

/** `settings` without its `key`: a copy, the key gone. */
function without(settings: Settings, key: string): Settings {
  const copy = { ...settings };
  delete copy[key];
  return copy;
}

/** `settings` with no disqualify setting, which is the rule off (operator ruling 48). */
function forfeitRuleOff(settings: Settings): Settings {
  const policy = settings['tournamentPolicy'];
  if (!policy || typeof policy !== 'object') return settings;
  return { ...settings, tournamentPolicy: without(policy as Settings, 'disqualifyAfter') };
}

/**
 * A patch's `tournamentPolicy.disqualifyAfter: null` is the organiser choosing Off (operator
 * ruling 52): the patch without it, and whether it was there. The ONE place the null is read, for
 * the settings save and a move alike: merged as sent, `deepMergeJson` would write the null through
 * and the schema's `.default(2)` refuses a null.
 */
function forfeitOffOf(patch: Settings | undefined): { patch: Settings | undefined; off: boolean } {
  const policy = patch?.['tournamentPolicy'];
  if (!patch || !policy || typeof policy !== 'object') return { patch, off: false };
  if ((policy as Settings)['disqualifyAfter'] !== null) return { patch, off: false };
  const rest = without(policy as Settings, 'disqualifyAfter');
  return {
    patch: Object.keys(rest).length
      ? { ...patch, tournamentPolicy: rest }
      : without(patch, 'tournamentPolicy'),
    off: true,
  };
}

/**
 * A stored match format as the engine reads it, its legacy keys folded into the modern ones. One
 * the engine refuses (a club seed is stored unchecked) is answered as stored: the sent keys then go
 * onto it and the normalize that follows decides, so a save that replaces the refused key repairs
 * the row, and any other save is refused in the engine's words.
 */
function engineFormatOr(stored: unknown): unknown {
  try {
    return normalizeMatchFormatConfig(stored);
  } catch {
    return stored;
  }
}

/**
 * `base` with the caller's `patch` on top: the ONE merge of a settings write (a save, a create, a
 * move). The base's match format is normalized BEFORE the sent one goes on top, so a stored legacy
 * key (`firstToPoints`, which the normalizer prefers to `pointCap`) cannot beat the organiser's
 * new value; it is written normalized, as the engine reads it. Off for the forfeit rule removes
 * it. Throws the engine's ZodError on a refused format: run it under `inEngineWords`.
 */
function mergedSettings(base: unknown, patch: Settings | undefined): Settings {
  const stored = objectOr(base);
  const { patch: sent = {}, off } = forfeitOffOf(patch);
  let settings = deepMergeJson(stored, without(sent, 'matchFormat')) as Settings;
  if (sent['matchFormat'] !== undefined) {
    const own = engineFormatOr(stored['matchFormat'] ?? {});
    settings = {
      ...settings,
      matchFormat: normalizeMatchFormatConfig(deepMergeJson(own, sent['matchFormat'])),
    };
  }
  return off ? forfeitRuleOff(settings) : settings;
}

/**
 * The settings a Tournament stores after a save of its own ruleset's settings: what it stored with
 * what was sent on top, and nothing else (operator rulings 48, 49). No ruleset default is filled
 * in and no schema default written: a setting the Tournament lacks keeps playing the engine's
 * value, and a save that does not touch the forfeit rule never turns it on. The parse runs over
 * exactly what is written, so a refusal is a 400 in the engine's words, and the write keeps only
 * the keys the parse holds (a Generic ruleset has no Tournament policy).
 */
export function settingsOfSave(save: {
  code: string;
  stored: unknown;
  patch?: Settings;
}): Settings {
  return inEngineWords(() => {
    const settings = mergedSettings(save.stored, save.patch);
    const parsed = validateTournamentRulesetConfig(save.code, settings);
    return Object.fromEntries(
      Object.keys(parsed).flatMap((key) => (key in settings ? [[key, settings[key]]] : [])),
    );
  });
}

/**
 * The settings a Tournament stores when it starts on a pair or moves to one: `seed` (the pair's
 * settings, with what a move keeps) and the caller's patch on top. A coded engine (TF_v1, a fork,
 * a built-in) stores the full parse, as it always did, but never a forfeit rule the settings did
 * not hold: the parse fills a missing one with 2, and a missing rule is off (ruling 48). A club
 * formula stores only what its seed holds and the patch sends (operator ruling 53): the parse
 * would fill TF_v1's own keys, the forfeit rule among them, into a ruleset that never had them.
 * Create and every move ask it.
 */
export function settingsOfSeed(seeded: {
  code: string;
  kind: ScoringStructure['kind'];
  seed: unknown;
  patch?: Settings;
}): Settings {
  if (seeded.kind === 'formula') {
    return settingsOfSave({ code: seeded.code, stored: seeded.seed, patch: seeded.patch });
  }
  return inEngineWords(() => {
    const settings = mergedSettings(seeded.seed, seeded.patch);
    const parsed = validateTournamentRulesetConfig(seeded.code, settings);
    return disqualifyAfterOf(settings) === null ? forfeitRuleOff(parsed) : parsed;
  });
}

export interface RulesetMove {
  fromCode: string;
  toCode: string;
  /** The target pair is a built-in (in the code registry). */
  builtIn: boolean;
  /** The settings stored on the Tournament before the move (null when none). */
  stored: unknown;
  /** The new pair's settings. */
  defaults: Record<string, unknown>;
}

/** Whether a move keeps what the Tournament stored: a built-in's other version. */
function keepsStored(move: Pick<RulesetMove, 'fromCode' | 'toCode' | 'builtIn'>): boolean {
  return move.builtIn && move.fromCode === move.toCode;
}

/**
 * The settings a move starts from, before the caller's patch (`settingsOfSeed` puts it on). A kept
 * row keeps its forfeit rule as it stood: the defaults do not fill one it lacks (ruling 48).
 */
export function settingsAfterMove(move: RulesetMove): Record<string, unknown> {
  if (!keepsStored(move)) return move.defaults;
  const kept = deepMergeJson(move.defaults, move.stored) as Record<string, unknown>;
  return disqualifyAfterOf(move.stored) === null ? forfeitRuleOff(kept) : kept;
}

/**
 * The stored scoring config with the buttons and afterblow mode of `seed` (the
 * new pair's, `buildSeededScoringConfig`) and the stored display, normalized as
 * every write stores it.
 */
export function seededScoringOfMove(
  stored: unknown,
  seed: Record<string, unknown>,
): TournamentScoringConfig {
  const own = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return normalizeTournamentScoringConfig({
    ...own,
    afterblowMode: seed['afterblowMode'],
    buttons: seed['buttons'],
  });
}

/** A move of a Tournament's pair, as a door asks for it. */
export interface MoveRequest {
  fromCode: string;
  toCode: string;
  toVersion: string;
  /** The Tournament's stored `ruleset_config` and `scoring_config_json`, raw. */
  storedSettings: unknown;
  storedScoring: unknown;
  /** Settings the caller sends with the move (the PATCH's `rulesetConfig`). */
  patch?: Record<string, unknown>;
}

/** The rules after a move: the settings written, and the seeded scoring config or null when kept. */
export interface RulesAfterMove {
  rulesetConfig: Settings;
  seededScoring: TournamentScoringConfig | null;
}

/**
 * The settings and the scoring config a Tournament holds after `move`. The PATCH
 * switch, the re-pin and its preview all ask it, so the preview lists what the
 * re-pin writes. The target's settings and grammar are read at its version, as
 * the scorer reads it; the seed reads the targets of the pair's kind.
 */
export async function nextOfMove(
  deps: { supabase: SupabaseService; registry: RulesetRegistry },
  move: MoveRequest,
): Promise<RulesAfterMove> {
  const { supabase, registry } = deps;
  const builtIn = isSystemRuleset(registry, move.toCode, move.toVersion);
  const [defaults, kind] = await Promise.all([
    resolveRulesetConfigDefaults(supabase, move.toCode, move.toVersion),
    scoringKindOf(supabase, registry, move.toCode, move.toVersion),
  ]);
  const seed = settingsAfterMove({ ...move, builtIn, stored: move.storedSettings, defaults });
  const rulesetConfig = settingsOfSeed({ code: move.toCode, kind, seed, patch: move.patch });
  if (keepsStored({ ...move, builtIn })) return { rulesetConfig, seededScoring: null };
  const grammar = await resolveRulesetGrammar(supabase, registry, move.toCode, move.toVersion);
  const seedScoring = buildSeededScoringConfig(grammar, rulesetConfig, kind);
  return { rulesetConfig, seededScoring: seededScoringOfMove(move.storedScoring, seedScoring) };
}

/** What a new Tournament on a pair is seeded with: its settings and its raw scoring config. */
export interface RulesSeed {
  config: Settings;
  scoring: Record<string, unknown>;
}

/**
 * The seed of a pair at `version`, read as a create reads it (`resolveRulesetConfigDefaults`, the
 * grammar, the kind): what a Tournament on it starts from (operator ruling 51).
 */
export async function rulesSeedOf(
  deps: { supabase: SupabaseService; registry: RulesetRegistry },
  code: string,
  version: string,
): Promise<RulesSeed> {
  const { supabase, registry } = deps;
  const [config, grammar, kind] = await Promise.all([
    resolveRulesetConfigDefaults(supabase, code, version),
    resolveRulesetGrammar(supabase, registry, code, version),
    scoringKindOf(supabase, registry, code, version),
  ]);
  return { config, scoring: buildSeededScoringConfig(grammar, config, kind) };
}
