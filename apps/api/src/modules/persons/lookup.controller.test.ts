import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LookupController } from './lookup.controller';
import { CsvImportService } from './csv-import.service';

// ── Similarity helper (mirrors the SQL GREATEST logic) ────────────────────────
// Used to simulate pg_trgm results in tests without a live DB.

function trigramSimilarity(a: string, b: string): number {
  // Simple bigram overlap as a proxy for trigram similarity
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const na = normalize(a);
  const nb = normalize(b);

  const getBigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };

  const ba = getBigrams(na);
  const bb = getBigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;

  let intersection = 0;
  for (const g of ba) if (bb.has(g)) intersection++;
  return (2 * intersection) / (ba.size + bb.size);
}

// ── Mock persons dataset ──────────────────────────────────────────────────────

const PERSONS = [
  {
    id: '1',
    given_name: 'Jean',
    family_name: 'Dupont',
    email: 'jean.dupont@gmail.com',
    club: 'Lyon AMHE',
  },
  {
    id: '2',
    given_name: 'Jéan',
    family_name: 'Martin',
    email: 'jean.martin@example.com',
    club: 'Cercle PRMD',
  },
  {
    id: '3',
    given_name: 'Jean-Pierre',
    family_name: 'Lambert',
    email: 'jp.lambert@example.com',
    club: null,
  },
  {
    id: '4',
    given_name: 'Marie',
    family_name: 'Dupont',
    email: 'marie.dupont@example.com',
    club: 'Lyon AMHE',
  },
  {
    id: '5',
    given_name: 'Pierre',
    family_name: 'Martin',
    email: 'pierre.martin@example.com',
    club: null,
  },
];

function simulateLookup(query: string, threshold = 0.3, limit = 10) {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const nq = normalize(query);

  return PERSONS.map((p) => {
    const sim = Math.max(
      trigramSimilarity(p.given_name, query),
      trigramSimilarity(p.family_name, query),
      trigramSimilarity(`${p.given_name} ${p.family_name}`, query),
      // Also check if query is a prefix (for short queries like "jean")
      normalize(p.given_name).startsWith(nq) ? 0.5 : 0,
      normalize(p.family_name).startsWith(nq) ? 0.4 : 0,
    );
    return { ...p, similarity: sim };
  })
    .filter((p) => p.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// ── Mock Supabase ─────────────────────────────────────────────────────────────

function makeMockSupabase(query: string) {
  const results = simulateLookup(query);
  return {
    service: {
      rpc: vi.fn().mockResolvedValue({
        data: results.map((p) => ({
          id: p.id,
          given_name: p.given_name,
          family_name: p.family_name,
          club_label: p.club,
          masked_email: `${p.email[0]}***@${p.email.split('@')[1]?.split('.')[0]?.[0]}***.${p.email.split('.').pop()}`,
        })),
        error: null,
      }),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LookupController', () => {
  let csvService: CsvImportService;

  beforeEach(() => {
    csvService = new CsvImportService();
  });

  describe('lookup — query "jean"', () => {
    it('returns Jean Dupont, Jéan Martin, Jean-Pierre Lambert', async () => {
      const mockSupabase = makeMockSupabase('jean');
      const controller = new LookupController(mockSupabase as never, csvService);

      const results = await controller.lookup('event-1', { q: 'jean' });
      const names = results.map((r) => r.given_name);

      expect(names).toContain('Jean');
      expect(names).toContain('Jéan');
      expect(names).toContain('Jean-Pierre');
    });

    it('does NOT return Marie Dupont for query "jean"', async () => {
      const mockSupabase = makeMockSupabase('jean');
      const controller = new LookupController(mockSupabase as never, csvService);

      const results = await controller.lookup('event-1', { q: 'jean' });
      const names = results.map((r) => r.given_name);

      expect(names).not.toContain('Marie');
    });
  });

  describe('lookup — email masking', () => {
    it('returns masked email, never plain email', async () => {
      const mockSupabase = makeMockSupabase('jean');
      const controller = new LookupController(mockSupabase as never, csvService);

      const results = await controller.lookup('event-1', { q: 'jean' });
      for (const r of results) {
        expect(r.masked_email).toMatch(/\*\*\*/);
        expect(r.masked_email).not.toContain('@gmail.com');
        expect(r.masked_email).not.toContain('jean.dupont');
      }
    });
  });

  describe('lookup — max 10 results', () => {
    it('passes limit=10 to the RPC (capped at 10)', async () => {
      const rpcMock = vi.fn().mockResolvedValue({
        data: Array.from({ length: 10 }, (_, i) => ({
          id: `${i}`,
          given_name: 'Jean',
          family_name: `Person${i}`,
          club_label: null,
          masked_email: 'j***@e***.com',
        })),
        error: null,
      });
      const mockSupabase = { service: { rpc: rpcMock } };
      const controller = new LookupController(mockSupabase as never, csvService);
      await controller.lookup('event-1', { q: 'jean', limit: '50' });
      // Verify the RPC was called with p_limit capped at 10
      expect(rpcMock).toHaveBeenCalledWith(
        'lookup_persons',
        expect.objectContaining({
          p_limit: 10,
        }),
      );
    });
  });

  describe('lookup — validation', () => {
    it('throws BadRequestException for empty query', async () => {
      const mockSupabase = { service: { rpc: vi.fn() } };
      const controller = new LookupController(mockSupabase as never, csvService);

      await expect(controller.lookup('event-1', { q: '' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for whitespace-only query', async () => {
      const mockSupabase = { service: { rpc: vi.fn() } };
      const controller = new LookupController(mockSupabase as never, csvService);

      await expect(controller.lookup('event-1', { q: '   ' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('lookup — fallback on RPC error', () => {
    it('falls back to ilike search when RPC fails', async () => {
      const mockSupabase = {
        service: {
          rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'function not found' } }),
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: '1',
                  given_name: 'Jean',
                  family_name: 'Dupont',
                  email: 'jean@example.com',
                  clubs: { name: 'Lyon AMHE' },
                },
              ],
              error: null,
            }),
          }),
        },
      };
      const controller = new LookupController(mockSupabase as never, csvService);
      const results = await controller.lookup('event-1', { q: 'jean' });
      expect(results).toHaveLength(1);
      expect(results[0]?.given_name).toBe('Jean');
      expect(results[0]?.masked_email).toMatch(/\*\*\*/);
    });
  });
});
