export interface ReviewQueueItem {
  type:
    | 'deletion'
    | 'exchange_edit'
    | 'club_review'
    | 'ruleset_submission'
    | 'league_tournament_request'
    | 'league_membership_request';
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'linked' | 'cancelled';
  targetLabel: string;
  targetHref: string | null;
  requesterUserId: string;
  requesterName: string;
  requesterEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  reason: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
