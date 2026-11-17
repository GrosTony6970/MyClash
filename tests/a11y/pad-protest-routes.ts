/**
 * The protest doors of the best-of stub (`pad-rounds-stub.ts`): a protest is
 * taken between rounds and after the end, in the round that is (or was) open,
 * and the bout's protests are read back as the server keeps them.
 */
import type { Route } from '@playwright/test';

/** What the doors read and write of the stub. */
interface ProtestStub {
  /** Every write the server took or refused, in order. */
  sent: string[];
  row: { id: string; current_round: number };
  protests: Array<Record<string, unknown>>;
}

/** Answers a protest door, or null when the request is for another door. */
export function answerProtests(
  stub: ProtestStub,
  route: Route,
  method: string,
  path: string,
): Promise<void> | null {
  if (!path.endsWith('/protests')) return null;
  if (method === 'GET') return route.fulfill({ json: stub.protests });
  if (method !== 'POST') return null;
  const body = route.request().postDataJSON() as Record<string, unknown>;
  stub.sent.push('POST /protests');
  const row = {
    id: `protest-${stub.protests.length + 1}`,
    client_uuid: body['clientUuid'],
    match_id: stub.row.id,
    registration_id: body['registrationId'],
    sequence: body['sequence'],
    round_number: stub.row.current_round,
    clock_time_ms: body['clockTimeMs'] ?? null,
    occurred_at: body['occurredAt'],
    voided: false,
  };
  stub.protests.push(row);
  return route.fulfill({ status: 201, json: row });
}
