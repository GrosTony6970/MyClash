import { Injectable } from '@nestjs/common';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchesService } from '../matches/matches.service';
import { UserDirectoryService } from '../user-directory/user-directory.service';
import type { ListExchangeEditRequestsDto } from './dto/exchange-edit-requests.dto';

@Injectable()
export class ExchangeEditRequestsAdminService {
  constructor(
    private readonly frozenResults: FrozenResultsGuard,
    private readonly matches: MatchesService,
    private readonly userDirectory: UserDirectoryService,
  ) {}

  async list(query: ListExchangeEditRequestsDto) {
    const rows = await this.frozenResults.listRequests(query.status ?? 'pending');
    const userMap = await this.userDirectory.resolveUsers(
      rows.flatMap((r) => [r.requested_by_user_id, r.reviewed_by_user_id ?? '']),
    );
    return rows.map((r) => {
      const requester = userMap.get(r.requested_by_user_id);
      const reviewer = r.reviewed_by_user_id ? userMap.get(r.reviewed_by_user_id) : null;
      return {
        ...r,
        requesterName: requester?.name ?? null,
        requesterEmail: requester?.email ?? null,
        reviewedByName: reviewer?.name ?? null,
        reviewedByEmail: reviewer?.email ?? null,
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
