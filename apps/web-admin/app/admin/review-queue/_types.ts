export interface ReviewQueueItem {
  type: 'deletion' | 'exchange_edit' | 'club_review' | 'ruleset_submission';
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'linked' | 'cancelled';
  targetLabel: string;
  targetHref: string | null;
  requesterUserId: string;
  requesterName: string;
  organizationId: string | null;
  organizationName: string | null;
  reason: string | null;
  rejectionReason: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
