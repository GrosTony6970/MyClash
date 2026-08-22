/**
 * Shared wrappers for the three admin POST sites that try to register
 * a person into a tournament. The backend
 * (`POST /api/v1/tournaments/:id/registrations`) returns 409 with
 * `details.reason: 'tournament_full'` when capacity is reached — see
 * apps/api/src/modules/registrations/registrations.service.ts:120-174.
 * Duplicate registrations come back as 400 on a different path, so the
 * 409 reliably means "full" and the FE can offer a waiting-list
 * affordance with one click.
 *
 * Pure functions — kept React-free for easy fetch-mocked unit tests.
 *
 * They carry the seam's `ApiFailure` rather than a plucked string. The two
 * hardcoded English fallbacks that used to live here ('Registration failed',
 * 'Could not add to the waiting list') broke hard rule 6 — and were also dead:
 * no caller ever read the `message` field, they only count failures and list
 * the tournaments or people involved. Handing the failure back leaves the
 * sentence to `failureMessage` at whatever call site decides to render one.
 */

import { apiRequest, type ApiFailure } from '@myclash/api-client';

export type RegisterOutcome =
  | { status: 'ok'; data: unknown }
  | {
      status: 'full';
      registeredCount: number;
      maxParticipants: number;
    }
  | { status: 'error'; failure: ApiFailure };

/** `details` is `Record<string, unknown>`; narrow one field at a time. */
function numberFrom(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

export async function tryRegisterInTournament(
  apiUrl: string,
  tournamentId: string,
  body: Record<string, unknown>,
): Promise<RegisterOutcome> {
  const r = await apiRequest<unknown>(apiUrl, `/api/v1/tournaments/${tournamentId}/registrations`, {
    method: 'POST',
    body,
  });
  if (r.ok) return { status: 'ok', data: r.data ?? null };

  // Read as a FIELD of the extension bag, not by matching English. `code` is
  // the filter's own 'CONFLICT' here, so branching on it would compile, pass,
  // and silently stop telling a full tournament from any other conflict.
  if (r.kind === 'http' && r.status === 409 && r.details?.['reason'] === 'tournament_full') {
    return {
      status: 'full',
      registeredCount: numberFrom(r.details['registeredCount']),
      maxParticipants: numberFrom(r.details['maxParticipants']),
    };
  }
  return { status: 'error', failure: r };
}

export async function addToWaitingList(
  apiUrl: string,
  tournamentId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; failure: ApiFailure }> {
  const r = await apiRequest(apiUrl, `/api/v1/tournaments/${tournamentId}/waitlist`, {
    method: 'POST',
    body,
  });
  return r.ok ? { ok: true } : { ok: false, failure: r };
}
