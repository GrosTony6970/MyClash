/**
 * The Fighters of an audited forfeit rules change, named for the organiser (the audited settings
 * change, revisions 13-16 of its plan; operator rulings 143, 144, 161).
 *
 * The PREVIEW, in the refusal that opens the dialog, names each Fighter whose status the change
 * moves ("Paul Martin: in → disqualified"), read from the database's own rule
 * (`fighters_status_under`). It fails closed: the organiser confirms knowing whom the change moves,
 * so a read that fails, or a Fighter it cannot name, refuses 503 `rules_check_unavailable`.
 *
 * The ANSWER after the write names who did not follow, and who was brought back in step, by name
 * or `null` when a name could not be read: the rules are written by then, so nothing refuses.
 *
 * Names are read through `EntityLabelService`, which reads at most 150 ids per kind per call:
 * read in chunks. They reach the dialog only; never the record, `audit_log` or the public notice.
 */
import type { Logger } from '@nestjs/common';
import { RULES_CHANGE_CODES } from '@myclash/types';
import { OperationalUnavailableException } from '../../common/operational-exception';
import type { EntityLabelService } from '../entity-label/entity-label.service';
import { MAX_IDS_PER_KIND } from '../entity-label/entity-label.service';
import { labelKey } from '../entity-label/entity-label-specs';
import type { FighterStatusService } from '../matches/fighter-status.service';
import { isMovedBy, statusBeforeOf, statusRows } from '../matches/follow-rules-change';
import type { ForfeitVoidActor } from '../matches/forfeit-void';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ForfeitSide } from './forfeit-rules-lock';
import { failClosed, type PreviewFighter } from './settings-save-lock';

/** A Fighter of the answer: a name, or null when it could not be read. */
export interface NamedFighter {
  registrationId: string;
  name: string | null;
}

/** The names of `ids`, in chunks the label reader takes; a name it could not read is absent. */
export async function registrationNames(
  labels: EntityLabelService,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let at = 0; at < ids.length; at += MAX_IDS_PER_KIND) {
    const chunk = new Set(ids.slice(at, at + MAX_IDS_PER_KIND));
    const { labels: found } = await labels.resolve(new Map([['registration', chunk]]));
    for (const id of chunk) {
      const name = found.get(labelKey('registration', id));
      if (name) names.set(id, name);
    }
  }
  return names;
}

/** The answer's Fighters, named, in the order given. */
export async function namedFighters(
  labels: EntityLabelService,
  ids: readonly string[],
): Promise<NamedFighter[]> {
  const names = await registrationNames(labels, ids);
  return ids.map((registrationId) => ({ registrationId, name: names.get(registrationId) ?? null }));
}

/** What the follow of a save needs: its forfeit side, the status settle and the label reader. */
export interface RulesFollow {
  side: ForfeitSide;
  status: FighterStatusService;
  labels: EntityLabelService;
}

/** What the answer says of the follow (ruling 144). */
export interface FollowAnswer {
  notSettled: NamedFighter[];
  inStep: NamedFighter[];
  handOffFailed: boolean;
  followFailed: boolean;
}

/**
 * The Fighters follow the change, after the write and never undoing it (ruling 143); the answer
 * names who did not follow and who was brought back in step. No follow: nothing to name.
 */
export async function followNamed(
  follow: RulesFollow | null,
  tournamentId: string,
  actor: ForfeitVoidActor,
): Promise<FollowAnswer> {
  if (!follow) return { notSettled: [], inStep: [], handOffFailed: false, followFailed: false };
  const { side, status, labels } = follow;
  const followed = await status.followRulesChange(tournamentId, side, actor);
  return {
    notSettled: await namedFighters(labels, followed.notSettled),
    inStep: await namedFighters(labels, followed.inStep),
    handOffFailed: followed.handOffFailed,
    followFailed: followed.followFailed,
  };
}

export interface PreviewDeps {
  supabase: SupabaseService;
  labels: EntityLabelService;
  logger: Logger;
}

/**
 * The Fighters a forfeit rules change moves, for the dialog: those whose status the rule itself
 * moves; when the rules before did not parse, those out of step with the rules after (their stored
 * status is all there is to compare).
 */
export async function previewFighters(
  deps: PreviewDeps,
  tournamentId: string,
  side: ForfeitSide,
): Promise<PreviewFighter[]> {
  const rows = await failClosed(deps.logger, tournamentId, () =>
    statusRows(deps.supabase.service, tournamentId, side.before, side.after, []),
  );
  const moved = rows
    .filter((row) => isMovedBy(side, row))
    .map((row) => ({
      registrationId: row.registration_id,
      before: statusBeforeOf(side, row),
      after: row.status_after,
    }));
  const names = await registrationNames(
    deps.labels,
    moved.map((fighter) => fighter.registrationId),
  );
  const unnamed = moved.filter((fighter) => !names.has(fighter.registrationId));
  if (unnamed.length > 0) {
    deps.logger.warn(
      `Tournament ${tournamentId}: ${unnamed.length} Fighters a rules change moves could not be named`,
    );
    throw new OperationalUnavailableException({
      code: RULES_CHANGE_CODES.checkUnavailable,
      message: 'The rules of this tournament could not be checked. Try again in a moment.',
    });
  }
  return moved.map((fighter) => ({ ...fighter, name: names.get(fighter.registrationId)! }));
}
