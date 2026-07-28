import { Injectable } from '@nestjs/common';
import { collectPayloadRefs } from '../entity-label/audit-payload-refs';
import { type EntityKind, labelKey } from '../entity-label/entity-label-specs';
import {
  EntityLabelService,
  MAX_PAYLOAD_REFS,
  addRefs,
} from '../entity-label/entity-label.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchesService } from '../matches/matches.service';
import type { ListExchangeEditRequestsDto } from './dto/exchange-edit-requests.dto';

/** The request rows carry an event/match/exchange triple that must never render raw. */
const COLUMN_REFS = [
  ['event_id', 'event'],
  ['match_id', 'match'],
  ['exchange_id', 'exchange'],
] as const satisfies ReadonlyArray<readonly [string, EntityKind]>;

@Injectable()
export class ExchangeEditRequestsAdminService {
  constructor(
    private readonly frozenResults: FrozenResultsGuard,
    private readonly matches: MatchesService,
    private readonly entityLabels: EntityLabelService,
  ) {}

  async list(query: ListExchangeEditRequestsDto) {
    const rows = await this.frozenResults.listRequests(query.status ?? 'pending');

    const budget = { remaining: MAX_PAYLOAD_REFS };
    const rowRefs = rows.map((r) =>
      collectPayloadRefs(`exchange_edit_request.${r.request_type}`, r.requested_payload, budget),
    );

    const refs = new Map<EntityKind, Set<string>>();
    addRefs(
      refs,
      'user',
      rows.flatMap((r) => [r.requested_by_user_id, r.reviewed_by_user_id]),
    );
    for (const r of rows) {
      for (const [column, kind] of COLUMN_REFS) {
        addRefs(refs, kind, [(r as unknown as Record<string, string | null>)[column]]);
      }
    }
    for (const list of rowRefs) {
      for (const ref of list) addRefs(refs, ref.kind, [ref.id]);
    }
    const { labels, users } = await this.entityLabels.resolve(refs);

    return rows.map((r, index) => {
      const requester = users.get(r.requested_by_user_id);
      const reviewer = r.reviewed_by_user_id ? users.get(r.reviewed_by_user_id) : null;
      const payloadLabels: Record<string, { label: string; kind: string }> = {};
      for (const ref of rowRefs[index] ?? []) {
        const label = labels.get(labelKey(ref.kind, ref.id));
        if (label) payloadLabels[ref.pointer] = { label, kind: ref.kind };
      }
      return {
        ...r,
        requesterName: requester?.name ?? null,
        requesterEmail: requester?.email ?? null,
        reviewedByName: reviewer?.name ?? null,
        reviewedByEmail: reviewer?.email ?? null,
        eventLabel: labels.get(labelKey('event', r.event_id)) ?? null,
        matchLabel: labels.get(labelKey('match', r.match_id)) ?? null,
        exchangeLabel: labels.get(labelKey('exchange', r.exchange_id)) ?? null,
        payloadLabels,
      };
    });
  }

  async approve(id: string, actorUserId: string) {
    const request = await this.frozenResults.loadPendingRequest(id);
    const result = await this.matches.approveFrozenExchangeEdit(request, actorUserId);
    await this.frozenResults.markApproved(request, actorUserId);
    return { approved: true, requestId: id, result };
  }

  async reject(id: string, actorUserId: string, reason: string) {
    const request = await this.frozenResults.loadPendingRequest(id);
    await this.frozenResults.markRejected(request, actorUserId, reason);
    return { rejected: true, requestId: id };
  }
}
