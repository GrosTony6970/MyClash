import { apiRequest } from '@myclash/api-client';
import { assignFailureText } from '@/lib/referee-reasons';

/** What an assign came to. `refusal` is null when there are no words (an aborted send). */
export type AssignAnswer =
  { assigned: true; refusal: null } | { assigned: false; refusal: string | null };

/** One referee for one slot. `confirm` goes ahead over Discouraged reasons the organiser has seen. */
export interface AssignPick {
  poolId: string;
  role: string;
  personId: string;
  confirm: boolean;
}

type Translate = Parameters<typeof assignFailureText>[0];

/**
 * ONE owner of "assign this referee" (quick win O8): the Event's referee board and the
 * board hook of the Pools, bracket and Swiss tabs each sent their own copy. The answer
 * carries the refusal in words, for the picker, and the board the server sends back.
 */
export async function postAssignment<Board>(
  apiUrl: string,
  eventId: string,
  pick: AssignPick,
  t: Translate,
  fallback: string,
): Promise<{ answer: AssignAnswer; board: Board | null }> {
  const { poolId, role, personId, confirm } = pick;
  const r = await apiRequest<Board>(apiUrl, `/api/v1/events/${eventId}/referee-assignments`, {
    method: 'POST',
    body: { poolId, role, personId, ...(confirm ? { confirm } : {}) },
  });
  // The one checker refuses by reason (ADR-016): the sentence the organiser needs in
  // order to pick somebody else, or confirm.
  if (!r.ok) {
    return { answer: { assigned: false, refusal: assignFailureText(t, r, fallback) }, board: null };
  }
  return { answer: { assigned: true, refusal: null }, board: r.data };
}
