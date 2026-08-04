import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LEGAL_POLICIES } from '@myclash/types';
import { LegalAcceptanceService } from './legal-acceptance.service';

const insertMock = vi.fn();
const orderMock = vi.fn();
const fromMock = vi.fn();

const mockSupabase = { service: { from: fromMock } };

/** Read chain: .from().select().eq().order() resolves. */
function readChain(result: unknown) {
  orderMock.mockResolvedValue(result);
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: orderMock,
    insert: insertMock,
  };
}

const CURRENT = {
  terms: LEGAL_POLICIES.terms.version,
  privacy: LEGAL_POLICIES.privacy.version,
};

describe('LegalAcceptanceService', () => {
  let service: LegalAcceptanceService;

  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
    fromMock.mockReturnValue(readChain({ data: [], error: null }));
    service = new LegalAcceptanceService(mockSupabase as never);
  });

  describe('assertCurrent', () => {
    it('returns the REGISTRY versions, not the ones the client posted', () => {
      // Same value here, but the object identity matters: a padded or
      // differently-cased string that somehow passed must never reach the row.
      expect(service.assertCurrent({ ...CURRENT })).toEqual(CURRENT);
    });

    it('rejects a stale version and names which document', () => {
      try {
        service.assertCurrent({ terms: '1999-01-01', privacy: CURRENT.privacy });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const body = (err as BadRequestException).getResponse() as {
          code: string;
          documents: string[];
          current: Record<string, string>;
        };
        expect(body.code).toBe('legal_version_stale');
        expect(body.documents).toEqual(['terms']);
        // The client needs these to retry without a full reload.
        expect(body.current).toEqual(CURRENT);
      }
    });

    it('rejects missing fields entirely', () => {
      expect(() => service.assertCurrent(undefined)).toThrow(BadRequestException);
      expect(() => service.assertCurrent({})).toThrow(BadRequestException);
    });
  });

  describe('recordForUser', () => {
    it('writes one row per document with the request context', async () => {
      await service.recordForUser('user-1', CURRENT, {
        ip: '203.0.113.4',
        userAgent: 'Firefox',
      });

      expect(fromMock).toHaveBeenCalledWith('legal_acceptances');
      const rows = insertMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r['document_kind']).sort()).toEqual(['privacy', 'terms']);
      expect(rows[0]).toMatchObject({
        user_id: 'user-1',
        guest_session_id: null,
        ip: '203.0.113.4',
        user_agent: 'Firefox',
      });
    });

    it('truncates an absurd user agent instead of storing a payload', async () => {
      await service.recordForUser('user-1', CURRENT, { userAgent: 'x'.repeat(2000) });
      const rows = insertMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect((rows[0]?.['user_agent'] as string).length).toBe(500);
    });

    it('does not throw when the insert fails — the account already exists', async () => {
      insertMock.mockResolvedValue({ error: { message: 'boom' } });
      await expect(service.recordForUser('user-1', CURRENT)).resolves.toBeUndefined();
    });
  });

  describe('recordForGuestSession', () => {
    it('keys the rows on the session and never on a user', async () => {
      await service.recordForGuestSession('session-1');
      const rows = insertMock.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row['user_id']).toBeNull();
        expect(row['guest_session_id']).toBe('session-1');
      }
    });
  });

  describe('pendingFor', () => {
    it('reports both documents when the user has accepted nothing', async () => {
      fromMock.mockReturnValue(readChain({ data: [], error: null }));
      expect(await service.pendingFor('user-1')).toEqual(['terms', 'privacy']);
    });

    it('reports nothing when both are accepted at the published version', async () => {
      fromMock.mockReturnValue(
        readChain({
          data: [
            { document_kind: 'terms', version: CURRENT.terms, accepted_at: '2026-06-01T00:00:00Z' },
            {
              document_kind: 'privacy',
              version: CURRENT.privacy,
              accepted_at: '2026-06-01T00:00:00Z',
            },
          ],
          error: null,
        }),
      );
      expect(await service.pendingFor('user-1')).toEqual([]);
    });

    it('reports a document whose published version has moved on', async () => {
      fromMock.mockReturnValue(
        readChain({
          data: [
            { document_kind: 'terms', version: '1999-01-01', accepted_at: '1999-01-01T00:00:00Z' },
            {
              document_kind: 'privacy',
              version: CURRENT.privacy,
              accepted_at: '2026-06-01T00:00:00Z',
            },
          ],
          error: null,
        }),
      );
      expect(await service.pendingFor('user-1')).toEqual(['terms']);
    });

    it('uses the NEWEST row per document, not the first one seen', async () => {
      // Append-only: an old acceptance always sits beside the new one. Reading
      // the wrong one would nag a user who has already re-accepted.
      fromMock.mockReturnValue(
        readChain({
          data: [
            { document_kind: 'terms', version: CURRENT.terms, accepted_at: '2026-07-01T00:00:00Z' },
            { document_kind: 'terms', version: '1999-01-01', accepted_at: '1999-01-01T00:00:00Z' },
            {
              document_kind: 'privacy',
              version: CURRENT.privacy,
              accepted_at: '2026-07-01T00:00:00Z',
            },
          ],
          error: null,
        }),
      );
      expect(await service.pendingFor('user-1')).toEqual([]);
    });

    it('reports nothing when the read itself fails — /me must not 500 over a banner', async () => {
      fromMock.mockReturnValue(readChain({ data: null, error: { message: 'down' } }));
      expect(await service.pendingFor('user-1')).toEqual([]);
    });
  });

  describe('summaryFor', () => {
    it('flags an accepted-but-superseded version as not current', async () => {
      fromMock.mockReturnValue(
        readChain({
          data: [
            { document_kind: 'terms', version: '1999-01-01', accepted_at: '1999-01-01T00:00:00Z' },
          ],
          error: null,
        }),
      );
      const summary = await service.summaryFor('user-1');
      expect(summary).toEqual([
        {
          kind: 'terms',
          version: '1999-01-01',
          acceptedAt: '1999-01-01T00:00:00Z',
          current: false,
        },
      ]);
    });
  });
});
