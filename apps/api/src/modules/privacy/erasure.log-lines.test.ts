import { Logger } from '@nestjs/common';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { ErasureService } from './erasure.service';

// An erasure's failures are logged loudly, but a database message can echo the values it was
// given (an email in a payload, an id): the line says the code in words, never the message.
const LEA_EMAIL = 'lea@example.test';
const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
afterEach(() => error.mockClear());
afterAll(() => error.mockRestore());

describe('ErasureService log lines', () => {
  it('a receipt that cannot be written logs its kind and the code in words', async () => {
    const db = mockSupabase({
      erasure_log: {
        data: null,
        error: { code: '23505', message: `duplicate key (subject_hash)=(… ${LEA_EMAIL})` },
      },
    });
    await new ErasureService({ service: db.service } as never).recordErasure(
      'u-lea',
      'account_deletion',
      {} as never,
    );
    expect(error.mock.calls).toEqual([
      ['erasure receipt failed (account_deletion): unique_violation (23505)'],
    ]);
  });

  it('an audit row that cannot be redacted logs its row id and the code in words', async () => {
    const row = { id: 'audit-1', action: 'person.update', payload_json: { email: LEA_EMAIL } };
    const found = async () => ({ data: [row], error: null });
    const audit = {
      select: () => ({ eq: found, in: found, contains: found }),
      update: () => ({
        eq: async () => ({
          data: null,
          error: { code: '57014', message: `canceling statement on ${LEA_EMAIL}` },
        }),
      }),
    };
    const erasure = new ErasureService({ service: { from: () => audit } } as never);
    const redact = (
      erasure as unknown as {
        redactAuditPayloads: (uid: string, gps: string[], persons: string[]) => Promise<number>;
      }
    ).redactAuditPayloads.bind(erasure);
    expect(await redact('u-lea', [], [])).toBe(0);
    expect(error.mock.calls).toEqual([
      ['audit redaction failed for audit-1: query_canceled (57014)'],
    ]);
  });
});
