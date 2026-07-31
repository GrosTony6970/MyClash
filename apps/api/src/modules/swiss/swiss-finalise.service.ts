import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
// Value import, not `import type`: Nest DI metadata.
import { SwissPairingService } from './swiss-pairing.service';
import { hasStartedDownstreamBracket, writeSwissConfig } from './swiss-phase-config';

/**
 * Freezing and unfreezing a Swiss phase (decision 13).
 *
 * Finalising says "these standings are the result", which resolves the podium
 * and stops auto-advance from pairing another round. It is REVERSIBLE on
 * purpose: an organiser who finalises after round 4 of 5 because the venue is
 * closing should be able to resume if the schedule recovers.
 *
 * The one thing that makes it irreversible is a bracket already being fought
 * from these standings — that bracket's round 1 IS this ranking.
 */
@Injectable()
export class SwissFinaliseService {
  private readonly logger = new Logger(SwissFinaliseService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pairing: SwissPairingService,
  ) {}

  async finalise(phaseId: string, actorUserId: string | null = null) {
    const context = await this.pairing.requireContext(phaseId);
    if (context.config.finalized) return context.config.finalized;

    const finalized = {
      // Rounds actually FOUGHT, not rounds generated: finalising with a paired
      // but unplayed round pending must not claim that round as a result.
      atRound: context.rounds.filter((r) => r.status === 'completed').length,
      at: new Date().toISOString(),
      byUserId: actorUserId ?? '',
    };
    await writeSwissConfig(this.supabase, phaseId, { ...context.config, finalized });
    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'swiss.finalise',
      entityType: 'phase',
      entityId: phaseId,
      payload: finalized,
    });
    this.logger.log(`swiss phase ${phaseId} finalised after round ${finalized.atRound}`);
    return finalized;
  }

  async unfinalise(phaseId: string, actorUserId: string | null = null) {
    const context = await this.pairing.requireContext(phaseId);
    if (!context.config.finalized) return { finalized: null };

    if (await hasStartedDownstreamBracket(this.supabase, context.tournamentId, phaseId)) {
      throw new ConflictException(
        'A bracket seeded from these standings has already started. Resuming would change the seeding it was built from.',
      );
    }

    await writeSwissConfig(this.supabase, phaseId, { ...context.config, finalized: null });
    await insertAuditLog(this.supabase.service, {
      actorUserId,
      action: 'swiss.unfinalise',
      entityType: 'phase',
      entityId: phaseId,
      payload: { wasFinalizedAt: context.config.finalized },
    });
    this.logger.log(`swiss phase ${phaseId} resumed`);
    return { finalized: null };
  }
}
