/**
 * Every bout of a piste, each as the scoring pad reads ONE bout: the row
 * `GET /matches/:id` answers and the summary `GET /matches/:id/summary` answers.
 *
 * The pad keeps them, so "Next match" opens the next bout when the network is
 * gone (quick-win ruling 4, the whole piste). One request, and a fixed number of
 * reads whatever the size of the piste: the pad asking sixty bouts one by one
 * would be a hundred and twenty throttled requests from the hall's one address.
 *
 * The order is the piste list's (`compareLiceMatchOrder`), which is also the
 * order the pad's Next and Previous tiles walk.
 */

import { BadRequestException, NotFoundException, type Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withBoutRules } from '../matches/bout-answer';
import { matchSummaries, type MatchSummary } from '../matches/match-summaries';
import type { RulesetResolver } from '../matches/ruleset-resolver.service';
import { compareLiceMatchOrder, LICE_MATCH_STATUSES } from './lice-matches';

export interface LiceBoutsPayload {
  liceId: string;
  liceName: string;
  bouts: Array<{
    /** The whole `matches` row, as `GET /matches/:id` gives it. */
    match: Record<string, unknown>;
    /**
     * Null when the summary view no longer holds the bout: it was deleted
     * between the two reads. A bracket slot with no fighters yet IS in the view,
     * with blank names.
     */
    summary: MatchSummary | null;
  }>;
}

export async function liceBouts(
  db: SupabaseClient,
  liceId: string,
  /** Each bout carries its own rules and edition, as `GET /matches/:id` gives them. */
  rulesets: RulesetResolver | undefined,
  logger: Pick<Logger, 'warn'>,
): Promise<LiceBoutsPayload> {
  const { data: lice, error: liceError } = await db
    .from('lices')
    .select('id,name')
    .eq('id', liceId)
    .maybeSingle();
  if (liceError) throw new BadRequestException(liceError.message);
  if (!lice) throw new NotFoundException('Lice not found');

  const { data, error } = await db
    .from('matches')
    .select(
      '*, match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json, penalty_ruleset_id)',
    )
    .eq('lice_id', liceId)
    .in('status', [...LICE_MATCH_STATUSES]);
  if (error) throw new BadRequestException(error.message);

  const rows = ((data ?? []) as Array<Record<string, unknown>>).sort(compareLiceMatchOrder);
  const summaries = await matchSummaries(
    db,
    rows.map((row) => row['id'] as string),
  );
  return {
    liceId: (lice as { id: string }).id,
    liceName: (lice as { name: string }).name,
    bouts: await Promise.all(
      rows.map(async (match) => ({
        match: await withBoutRules(match, rulesets, logger),
        summary: summaries.get(match['id'] as string) ?? null,
      })),
    ),
  };
}
