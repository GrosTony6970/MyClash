import { typeBadge } from '../review-queue/_components/queue-row-copy';

/**
 * What a row of the Exchange corrections page says that is not data.
 *
 * Both were English literals on the page. Literal keys, never composed: the
 * i18n sweep resolves a dotted string literal.
 */
type RequestType = 'void_exchange' | 'revert_void_exchange';
type RequestStatus = 'pending' | 'approved' | 'rejected';

/** The same words as the review queue's badge: one owner for "void" and "restore". */
export function requestTypeKey(type: RequestType): string {
  return typeBadge({ type: 'exchange_edit', exchangeAction: type }).labelKey;
}

export function requestStatusKey(status: RequestStatus): string {
  switch (status) {
    case 'pending':
      return 'admin.adminDesignReq.filterPending';
    case 'approved':
      return 'admin.adminDesignReq.filterApproved';
    case 'rejected':
      return 'admin.adminDesignReq.filterRejected';
  }
}
