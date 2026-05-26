import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIDataQualityService, detectPlaceholderName } from './ai-data-quality.service';

const fromMock = vi.fn();
const generateMock = vi.fn();
const getProviderConfigMock = vi.fn();

const mockSupabase = {
  service: { from: fromMock },
};

const mockPlatformAI = {
  getProviderConfig: getProviderConfigMock,
  generate: generateMock,
};

const isEnabledMock = vi.fn().mockResolvedValue(false);
const mockFlags = {
  isEnabled: isEnabledMock,
};

function chain(data: unknown = [], error: unknown = null) {
  const methods = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return Object.assign(Promise.resolve({ data, error }), methods);
}

describe('AIDataQualityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEnabledMock.mockResolvedValue(false);
    getProviderConfigMock.mockResolvedValue({
      provider: 'openai',
      hasKey: true,
      updatedAt: '2026-05-11T00:00:00Z',
    });
    generateMock.mockResolvedValue({
      text: JSON.stringify({
        confidence: 0.94,
        severity: 'high',
        summary: 'Likely duplicate identity.',
        recommendedAction: 'Review and merge if confirmed.',
      }),
      inputTokens: 10,
      outputTokens: 12,
      costEur: 0.001,
    });
  });

  it('rejects scans when the shared super-admin AI key is missing', async () => {
    getProviderConfigMock.mockResolvedValue(null);
    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );

    await expect(service.startScan('actor-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('creates deterministic duplicate findings, AI-ranks them, and logs platform usage', async () => {
    const scanInsert = chain({ id: 'scan-1' });
    const findingsUpsert = chain(null);
    const scanUpdate = chain(null);
    const usageInsert = chain(null);
    const globalPersons = chain([
      {
        id: 'gp-1',
        display_name: 'Jean Dupont',
        given_name: 'Jean',
        family_name: 'Dupont',
        hema_ratings_id: '10458',
        claimed_by_user_id: null,
        club_id: 'club-1',
        is_fighter: true,
        is_referee: false,
        is_workshop_participant: false,
        merged_into_id: null,
        deleted_at: null,
        clubs: { name: 'Lyon AMHE' },
      },
      {
        id: 'gp-2',
        display_name: 'Jean D.',
        given_name: 'Jean',
        family_name: 'Dupont',
        hema_ratings_id: '10458',
        claimed_by_user_id: null,
        club_id: 'club-1',
        is_fighter: true,
        is_referee: true,
        is_workshop_participant: false,
        merged_into_id: null,
        deleted_at: null,
        clubs: { name: 'Lyon AMHE' },
      },
    ]);
    const clubs = chain([
      {
        id: 'club-1',
        name: 'Lyon AMHE',
        abbreviation: 'LAMHE',
        city: 'Lyon',
        country_code: 'FR',
        unverified: 'false',
      },
      {
        id: 'club-2',
        name: 'Lyon AMHE ',
        abbreviation: 'LAMHE',
        city: 'Lyon',
        country_code: 'FR',
        unverified: 'true',
      },
    ]);
    const refereeQualifications = chain([]);

    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_data_quality_scans') return scanInsert;
      if (table === 'ai_data_quality_findings') return findingsUpsert;
      if (table === 'platform_ai_usage_log') return usageInsert;
      if (table === 'global_persons') return globalPersons;
      if (table === 'clubs') return clubs;
      if (table === 'referee_qualifications') return refereeQualifications;
      return scanUpdate;
    });

    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );
    const result = await service.startScan('actor-1');

    expect(result.scanId).toBe('scan-1');
    expect(result.findingCount).toBeGreaterThanOrEqual(2);
    expect(generateMock).toHaveBeenCalled();
    expect(findingsUpsert.upsert).toHaveBeenCalled();
    expect(usageInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'super_admin_data_quality',
        actor_user_id: 'actor-1',
      }),
    );
    const persisted = findingsUpsert.upsert.mock.calls[0]?.[0] as Array<{ finding_type: string }>;
    expect(persisted.map((f) => f.finding_type)).toContain('global_person_duplicate');
    expect(persisted.map((f) => f.finding_type)).toContain('club_duplicate');
  });

  it('keeps deterministic findings when AI returns invalid JSON', async () => {
    generateMock.mockResolvedValue({
      text: 'not-json',
      inputTokens: 1,
      outputTokens: 1,
      costEur: 0.0001,
    });
    const scanInsert = chain({ id: 'scan-1' });
    const findingsUpsert = chain(null);
    const noop = chain(null);
    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_data_quality_scans') return scanInsert;
      if (table === 'ai_data_quality_findings') return findingsUpsert;
      if (table === 'global_persons') {
        return chain([
          { id: 'a', given_name: 'A', family_name: 'B', display_name: 'A B' },
          { id: 'b', given_name: 'A', family_name: 'B', display_name: 'A B' },
        ]);
      }
      if (table === 'clubs' || table === 'referee_qualifications') return chain([]);
      return noop;
    });
    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );

    await service.startScan('actor-1');

    const persisted = findingsUpsert.upsert.mock.calls[0]?.[0] as Array<{ ai_summary: string }>;
    expect(persisted[0]?.ai_summary).toBe('AI summary unavailable.');
  });

  // ── Deterministic mode ──────────────────────────────────────────────────

  it('runs a deterministic scan without calling the LLM and persists candidates with confidence 1.0', async () => {
    const scanInsert = chain({ id: 'scan-det' });
    const findingsUpsert = chain(null);
    const noop = chain(null);
    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_data_quality_scans') return scanInsert;
      if (table === 'ai_data_quality_findings') return findingsUpsert;
      if (table === 'global_persons')
        return chain([
          // Two perfect duplicates → triggers global_person_duplicate.
          { id: 'gp-1', given_name: 'Jean', family_name: 'Dupont', hema_ratings_id: '10458' },
          { id: 'gp-2', given_name: 'Jean', family_name: 'Dupont', hema_ratings_id: '10458' },
          // Orphan with no references → identity_gap.global_person_no_links.
          { id: 'gp-orphan', display_name: 'Solo', is_referee: false },
          // Placeholder global → placeholder_name.
          { id: 'gp-test', display_name: 'test fighter' },
        ]);
      if (table === 'clubs')
        return chain([
          // Placeholder club → placeholder_name.
          { id: 'club-1', name: 'Demo Club' },
        ]);
      if (table === 'referee_qualifications') return chain([]);
      if (table === 'persons') return chain([]);
      if (table === 'registrations') return chain([]);
      return noop;
    });

    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );
    const result = await service.runDeterministicScan('actor-1');

    expect(result.scanId).toBe('scan-det');
    expect(generateMock).not.toHaveBeenCalled();
    expect(findingsUpsert.upsert).toHaveBeenCalled();
    const persisted = findingsUpsert.upsert.mock.calls[0]?.[0] as Array<{
      finding_type: string;
      confidence: number;
      ai_summary: string;
    }>;
    expect(persisted.every((f) => f.confidence === 1.0)).toBe(true);
    expect(persisted.every((f) => f.ai_summary.length > 0)).toBe(true);
    const types = persisted.map((f) => f.finding_type);
    expect(types).toContain('global_person_duplicate');
    expect(types).toContain('identity_gap');
    expect(types).toContain('placeholder_name');
  });

  it('flags event-scoped persons with no global_person_id as identity_gap.persons_unlinked', async () => {
    const scanInsert = chain({ id: 'scan-gap' });
    const findingsUpsert = chain(null);
    const noop = chain(null);
    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_data_quality_scans') return scanInsert;
      if (table === 'ai_data_quality_findings') return findingsUpsert;
      if (table === 'global_persons') return chain([]);
      if (table === 'clubs') return chain([]);
      if (table === 'referee_qualifications') return chain([]);
      if (table === 'persons')
        return chain([
          {
            id: 'p-1',
            event_id: 'e-1',
            given_name: 'Anna',
            family_name: 'Doe',
            global_person_id: null,
          },
        ]);
      if (table === 'registrations') return chain([]);
      return noop;
    });

    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );
    await service.runDeterministicScan('actor-1');

    const persisted = findingsUpsert.upsert.mock.calls[0]?.[0] as Array<{
      finding_type: string;
      evidence_json: { gap_code?: string };
    }>;
    const gap = persisted.find(
      (f) => f.finding_type === 'identity_gap' && f.evidence_json.gap_code === 'persons_unlinked',
    );
    expect(gap).toBeTruthy();
  });

  it('updates finding review status with actor metadata', async () => {
    const update = chain(null);
    fromMock.mockReturnValue(update);
    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );

    await service.updateFindingStatus('finding-1', 'dismissed', 'actor-1');

    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dismissed',
        reviewed_by_user_id: 'actor-1',
      }),
    );
    expect(update.eq).toHaveBeenCalledWith('id', 'finding-1');
  });
});

describe('detectPlaceholderName', () => {
  it('matches exact placeholders case-insensitively', () => {
    expect(detectPlaceholderName('test').matched).toBe(true);
    expect(detectPlaceholderName('TEST').matched).toBe(true);
    expect(detectPlaceholderName('demo').matched).toBe(true);
    expect(detectPlaceholderName('  placeholder  ').matched).toBe(true);
    expect(detectPlaceholderName('foo').matched).toBe(true);
  });

  it('matches "test<number>" and "test_<n>" variants', () => {
    expect(detectPlaceholderName('test1').matched).toBe(true);
    expect(detectPlaceholderName('test 1').matched).toBe(true);
    expect(detectPlaceholderName('test_2').matched).toBe(true);
    expect(detectPlaceholderName('TEST-3').matched).toBe(true);
  });

  it('matches placeholder prefix / suffix phrases', () => {
    expect(detectPlaceholderName('Test Fighter').matched).toBe(true);
    expect(detectPlaceholderName('demo club').matched).toBe(true);
    expect(detectPlaceholderName('Sample Person').matched).toBe(true);
    expect(detectPlaceholderName('John Test').matched).toBe(true);
    expect(detectPlaceholderName('Acme Demo').matched).toBe(true);
  });

  it('matches single-letter-flood and high-density gibberish', () => {
    expect(detectPlaceholderName('aaaaa').matched).toBe(true);
    expect(detectPlaceholderName('aaaaab').matched).toBe(true);
  });

  it('does not flag legitimate names', () => {
    expect(detectPlaceholderName('Anthony Garnier').matched).toBe(false);
    expect(detectPlaceholderName('Lyon AMHE').matched).toBe(false);
    expect(detectPlaceholderName('Sword & Buckler').matched).toBe(false);
    expect(detectPlaceholderName('A.B.C.').matched).toBe(false);
    expect(detectPlaceholderName('Tester').matched).toBe(false); // longer real word
  });

  it('returns false for empty / null input', () => {
    expect(detectPlaceholderName('').matched).toBe(false);
    expect(detectPlaceholderName(null).matched).toBe(false);
    expect(detectPlaceholderName(undefined).matched).toBe(false);
    expect(detectPlaceholderName('   ').matched).toBe(false);
  });

  it('reports the matched rule on positive hits (operator debug signal)', () => {
    expect(detectPlaceholderName('test').rule).toBe('exact:test');
    expect(detectPlaceholderName('test 1').rule).toBe('test_with_number');
    expect(detectPlaceholderName('Test Fighter').rule).toBe('placeholder_prefix');
    expect(detectPlaceholderName('aaaaa').rule).toBe('high_letter_density');
  });
});
