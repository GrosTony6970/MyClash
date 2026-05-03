import { Injectable } from '@nestjs/common';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchesService } from '../matches/matches.service';
import type { ListExchangeEditRequestsDto } from './dto/exchange-edit-requests.dto';

@Injectable()
export class ExchangeEditRequestsAdminService {
  constructor(
    private readonly frozenResults: FrozenResultsGuard,
    private readonly matches: MatchesService,
  ) {}

  async list(query: ListExchangeEditRequestsDto) {
    return this.frozenResults.listRequests(query.status ?? 'pending');
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
