import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIDataQualityService, detectPlaceholderName } from './ai-data-quality.service';

const fromMock = vi.fn();
const generateMock = vi.fn();
const getActiveKeyInfoMock = vi.fn();

const mockSupabase = {
  service: { from: fromMock },
};

const mockPlatformAI = {
  getActiveKeyInfo: getActiveKeyInfoMock,
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
    is: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return Object.assign(Promise.resolve({ data, error }), methods);
}

/**
 * `ai_data_quality_findings` is read AND written inside one scan
 * (upsert, then the reconcile pass selects and updates). A single
 * `chain()` would hand the same canned rows to all three, so give each
 * verb its own sub-chain and expose them for assertions.
 */
function findingsTable(existing: Array<{ id: string; fingerprint: string; status: string }> = []) {
  const upsertChain = chain(null);
  const selectChain = chain(existing);
  const updateChain = chain(null);
  return {
    upsert: vi.fn((_rows: unknown, _options?: unknown) => upsertChain),
    select: vi.fn((_columns: string) => selectChain),
    update: vi.fn((_patch: Record<string, unknown>) => updateChain),
    _select: selectChain,
    _update: updateChain,
  };
}

/** The rows a scan handed to `upsert`, typed for assertions. */
function upsertedRows(table: ReturnType<typeof findingsTable>): Array<{
  fingerprint: string;
  finding_type: string;
  status?: string;
  entity_ids?: Record<string, string[]>;
  evidence_json?: { reasons?: string[] };
}> {
  const rows = table.upsert.mock.calls[0]?.[0] as
    | Array<{
        fingerprint: string;
        finding_type: string;
        status?: string;
        entity_ids?: Record<string, string[]>;
        evidence_json?: { reasons?: string[] };
      }>
    | undefined;
  return rows ?? [];
}

describe('AIDataQualityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEnabledMock.mockResolvedValue(false);
    getActiveKeyInfoMock.mockResolvedValue({ id: 'p1', provider: 'openai' });
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
    getActiveKeyInfoMock.mockResolvedValue(null);
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
    const actorUuid = '22222222-2222-4222-8222-222222222222';
    const result = await service.startScan(actorUuid);

    expect(result.scanId).toBe('scan-1');
    expect(result.findingCount).toBeGreaterThanOrEqual(2);
    expect(generateMock).toHaveBeenCalled();
    expect(findingsUpsert.upsert).toHaveBeenCalled();
    expect(usageInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'super_admin_data_quality',
        actor_user_id: actorUuid,
      }),
    );
    const persisted = findingsUpsert.upsert.mock.calls[0]?.[0] as Array<{
      finding_type: string;
      evidence_json?: { reasons?: string[] };
    }>;
    expect(persisted.map((f) => f.finding_type)).toContain('global_person_duplicate');
    expect(persisted.map((f) => f.finding_type)).toContain('club_duplicate');
    // Regression guard: club name is embedded from clubs.name via the club_id
    // FK and flattened to `club_name`, so the same-club dedup signal fires.
    // Selecting a bare (non-existent) `club_name` column would 400 the whole
    // query and this reason would never appear.
    const gpDuplicate = persisted.find((f) => f.finding_type === 'global_person_duplicate');
    expect(gpDuplicate?.evidence_json?.reasons).toContain('same_club_name');
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

  // ── Operator-reported scenarios ─────────────────────────────────────────
  // Both tests lock the rules that catch the cases the operator hit on
  // the data-quality page (a fencer literally named "test", and two
  // identical event participants where one has no club).

  it('flags an event participant literally named "test" as placeholder_name', async () => {
    const scanInsert = chain({ id: 'scan-placeholder' });
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
            id: 'p-test',
            event_id: 'e-1',
            given_name: 'test',
            family_name: null,
            club_id: 'club-1',
            global_person_id: 'gp-test',
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
      entity_ids: { personIds?: string[] };
    }>;
    const placeholderForPerson = persisted.find(
      (f) =>
        f.finding_type === 'placeholder_name' && (f.entity_ids.personIds ?? []).includes('p-test'),
    );
    expect(placeholderForPerson).toBeTruthy();
  });

  it('flags two same-name event participants and the missing-club gap on one of them', async () => {
    const scanInsert = chain({ id: 'scan-dup-event' });
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
            id: 'p-a',
            event_id: 'e-1',
            given_name: 'Bob',
            family_name: 'Smith',
            club_id: 'club-1',
            global_person_id: null,
          },
          {
            id: 'p-b',
            event_id: 'e-1',
            given_name: 'Bob',
            family_name: 'Smith',
            // missing club on the second one
            club_id: null,
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
      entity_ids: { personIds?: string[] };
      evidence_json: Record<string, unknown>;
    }>;

    // missing_field: one row for p-b with club_id in missing_fields.
    const missing = persisted.find(
      (f) => f.finding_type === 'missing_field' && (f.entity_ids.personIds ?? []).includes('p-b'),
    );
    expect(missing).toBeTruthy();
    expect((missing!.evidence_json['missing_fields'] as string[]) ?? []).toContain('club_id');

    // event_person_duplicate: one row pairing p-a and p-b.
    const dup = persisted.find(
      (f) =>
        f.finding_type === 'event_person_duplicate' &&
        (f.entity_ids.personIds ?? []).slice().sort().join(',') === 'p-a,p-b',
    );
    expect(dup).toBeTruthy();
  });

  it('updates finding review status with actor metadata', async () => {
    const update = chain(null);
    fromMock.mockReturnValue(update);
    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );

    const reviewerUuid = '33333333-3333-4333-8333-333333333333';
    await service.updateFindingStatus('finding-1', 'dismissed', reviewerUuid);

    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dismissed',
        reviewed_by_user_id: reviewerUuid,
      }),
    );
    expect(update.eq).toHaveBeenCalledWith('id', 'finding-1');
  });

  // ── Cron / system actor: no auth.users row ──────────────────────────────
  // Regression: the daily cron passed the sentinel string 'system:cron'
  // (and the controller falls back to 'unknown') straight into the UUID
  // `actor_user_id` column, so every unattended scan died with
  // "invalid input syntax for type uuid". A non-UUID actor must be
  // normalised to NULL — the column is a nullable FK to auth.users.
  it('stores a null actor_user_id when the scan has no real user (cron)', async () => {
    const scanInsert = chain({ id: 'scan-cron' });
    const noop = chain([]);
    fromMock.mockImplementation((table: string) =>
      table === 'ai_data_quality_scans' ? scanInsert : noop,
    );
    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );

    await service.runDeterministicScan(null);

    expect(scanInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_user_id: null, status: 'running' }),
    );
  });

  it('normalises a non-UUID actor id (e.g. "system:cron" / "unknown") to null', async () => {
    const scanInsert = chain({ id: 'scan-sentinel' });
    const noop = chain([]);
    fromMock.mockImplementation((table: string) =>
      table === 'ai_data_quality_scans' ? scanInsert : noop,
    );
    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );

    await service.runDeterministicScan('system:cron');

    expect(scanInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_user_id: null }),
    );
  });

  it('preserves a valid UUID actor id (manual super-admin run)', async () => {
    const actorUuid = '11111111-1111-4111-8111-111111111111';
    const scanInsert = chain({ id: 'scan-manual' });
    const noop = chain([]);
    fromMock.mockImplementation((table: string) =>
      table === 'ai_data_quality_scans' ? scanInsert : noop,
    );
    const service = new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );

    await service.runDeterministicScan(actorUuid);

    expect(scanInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_user_id: actorUuid }),
    );
  });

  // ── Status ownership ────────────────────────────────────────────────────
  // The scan and the operator both write `status`, so the rule is who owns
  // which transition. The scan never writes it on upsert (the column
  // default supplies 'open' for a new fingerprint); it only closes what it
  // can no longer see and reopens what comes back — and only on rows with
  // no `reviewed_at`, which is the stamp `updateFindingStatus` always
  // leaves and the scan never does.
  //
  // Regression: both row builders hard-coded `status: 'open'` and the
  // upsert conflicts on the (scan-stable) fingerprint, so the 04:00 cron
  // silently undid every dismissal.

  /** Two global persons sharing a ratings id, plus their identity gaps. */
  function duplicatePairTables(findings: ReturnType<typeof findingsTable>, scanId: string) {
    const scanInsert = chain({ id: scanId });
    const noop = chain(null);
    return (table: string) => {
      if (table === 'ai_data_quality_scans') return scanInsert;
      if (table === 'ai_data_quality_findings') return findings;
      if (table === 'global_persons')
        return chain([
          { id: 'gp-1', given_name: 'Jean', family_name: 'Dupont', hema_ratings_id: '10458' },
          { id: 'gp-2', given_name: 'Jean', family_name: 'Dupont', hema_ratings_id: '10458' },
        ]);
      if (table === 'clubs') return chain([]);
      if (table === 'referee_qualifications') return chain([]);
      if (table === 'persons') return chain([]);
      if (table === 'registrations') return chain([]);
      return noop;
    };
  }

  function newService() {
    return new AIDataQualityService(
      mockSupabase as never,
      mockPlatformAI as never,
      mockFlags as never,
    );
  }

  it('never writes status on upsert, so a dismissal survives the deterministic rescan', async () => {
    const findings = findingsTable();
    fromMock.mockImplementation(duplicatePairTables(findings, 'scan-keep-det'));

    await newService().runDeterministicScan(null);

    const rows = upsertedRows(findings);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toHaveProperty('status');
  });

  it('never writes status on upsert on the AI path either', async () => {
    const findings = findingsTable();
    fromMock.mockImplementation(duplicatePairTables(findings, 'scan-keep-ai'));

    await newService().startScan('22222222-2222-4222-8222-222222222222');

    const rows = upsertedRows(findings);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).not.toHaveProperty('status');
  });

  it('auto-resolves an unreviewed finding the finders no longer produce', async () => {
    const findings = findingsTable([
      { id: 'f-stale', fingerprint: 'no-longer-produced', status: 'open' },
    ]);
    fromMock.mockImplementation(duplicatePairTables(findings, 'scan-close'));

    await newService().runDeterministicScan(null);

    // The projection must carry the fingerprint and the status, or the
    // partition below cannot be made — assert the string, not just the call.
    expect(findings.select).toHaveBeenCalledWith('id, fingerprint, status');
    expect(findings._select.is).toHaveBeenCalledWith('reviewed_at', null);
    expect(findings._select.lt).toHaveBeenCalledWith('updated_at', expect.any(String));
    expect(findings.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' }));
    expect(findings._update.in).toHaveBeenCalledWith('id', ['f-stale']);
  });

  it('guards the close write itself, not just the read that selected it', async () => {
    // The select filters on status and reviewed_at, but an operator can
    // dismiss the row in the window between that read and this write. The
    // same two filters on the update close it.
    const findings = findingsTable([
      { id: 'f-stale', fingerprint: 'no-longer-produced', status: 'open' },
    ]);
    fromMock.mockImplementation(duplicatePairTables(findings, 'scan-guard'));

    await newService().runDeterministicScan(null);

    expect(findings._update.eq).toHaveBeenCalledWith('status', 'open');
    expect(findings._update.is).toHaveBeenCalledWith('reviewed_at', null);
  });

  it('reopens a machine-resolved finding that the finders produce again', async () => {
    const first = findingsTable();
    fromMock.mockImplementation(duplicatePairTables(first, 'scan-probe'));
    await newService().runDeterministicScan(null);
    const duplicateFingerprint = upsertedRows(first).find(
      (row) => row.finding_type === 'global_person_duplicate',
    )?.fingerprint;
    expect(duplicateFingerprint).toBeTruthy();

    const second = findingsTable([
      { id: 'f-back', fingerprint: duplicateFingerprint!, status: 'resolved' },
    ]);
    fromMock.mockImplementation(duplicatePairTables(second, 'scan-reopen'));
    await newService().runDeterministicScan(null);

    expect(second.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
    expect(second._update.in).toHaveBeenCalledWith('id', ['f-back']);
    expect(second._update.eq).toHaveBeenCalledWith('status', 'resolved');
  });

  // ── The AI ranking budget ───────────────────────────────────────────────
  // Regression: the cap was a bare slice over the finder-ordered array, so
  // person duplicates (first) could eat all 100 calls and `missing_field`
  // (last) was never ranked. The capped length was also what got written
  // as candidate_count, so the two modes reported different totals for the
  // same data.

  /** 20 identical persons (190 duplicate pairs) plus one missing club. */
  function noisyRosterTables(findings: ReturnType<typeof findingsTable>, scanId: string) {
    const scanInsert = chain({ id: scanId });
    const noop = chain(null);
    const persons = Array.from({ length: 20 }, (_, i) => ({
      id: `gp-${i}`,
      given_name: 'Jean',
      family_name: 'Dupont',
      hema_ratings_id: '10458',
    }));
    return (table: string) => {
      if (table === 'ai_data_quality_scans') return scanInsert;
      if (table === 'ai_data_quality_findings') return findings;
      if (table === 'global_persons') return chain(persons);
      if (table === 'clubs') return chain([]);
      if (table === 'referee_qualifications') return chain([]);
      if (table === 'persons')
        return chain([
          {
            id: 'p-nofields',
            event_id: 'e-1',
            given_name: 'Anna',
            family_name: 'Doe',
            global_person_id: 'gp-0',
            club_id: null,
          },
        ]);
      if (table === 'registrations') return chain([]);
      return noop;
    };
  }

  it('spends the AI budget across finding types, so a missing field is still ranked', async () => {
    const findings = findingsTable();
    fromMock.mockImplementation(noisyRosterTables(findings, 'scan-budget'));

    await newService().startScan('22222222-2222-4222-8222-222222222222');

    const ranked = upsertedRows(findings);
    expect(ranked).toHaveLength(100);
    expect(ranked.map((row) => row.finding_type)).toContain('missing_field');
  });

  it('reports the true candidate total, so both modes agree on the same data', async () => {
    const aiFindings = findingsTable();
    fromMock.mockImplementation(noisyRosterTables(aiFindings, 'scan-total-ai'));
    const ai = await newService().startScan('22222222-2222-4222-8222-222222222222');

    const detFindings = findingsTable();
    fromMock.mockImplementation(noisyRosterTables(detFindings, 'scan-total-det'));
    const deterministic = await newService().runDeterministicScan(null);

    expect(ai.candidateCount).toBeGreaterThan(100);
    expect(ai.candidateCount).toBe(deterministic.candidateCount);
    // Only the ranked slice is persisted on the AI path — which is what
    // makes `finding_count < candidate_count` mean "the cap fired".
    expect(ai.findingCount).toBe(100);
    expect(deterministic.findingCount).toBe(deterministic.candidateCount);
  });

  it('logs a warning when the cap truncates, so it never fires in silence', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const findings = findingsTable();
    fromMock.mockImplementation(noisyRosterTables(findings, 'scan-warn'));

    await newService().startScan('22222222-2222-4222-8222-222222222222');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ranked 100 of'));
    warn.mockRestore();
  });

  // ── Duplicate finders: blocking keys ────────────────────────────────────
  // Both finders now pair only rows that share a blocking key instead of
  // scanning the whole table. Every reason in the predicates is equality
  // on one of those keys, so this must lose nothing — the tests below
  // drive each reason on its own, with the key it blocks on as the only
  // thing linking the pair. Add a reason without adding its bucket and
  // one of these goes red.

  async function scanWith(rows: { persons?: unknown[]; clubs?: unknown[] }) {
    const findings = findingsTable();
    const scanInsert = chain({ id: 'scan-dup' });
    const noop = chain(null);
    fromMock.mockImplementation((table: string) => {
      if (table === 'ai_data_quality_scans') return scanInsert;
      if (table === 'ai_data_quality_findings') return findings;
      if (table === 'global_persons') return chain(rows.persons ?? []);
      if (table === 'clubs') return chain(rows.clubs ?? []);
      if (table === 'referee_qualifications') return chain([]);
      if (table === 'persons') return chain([]);
      if (table === 'registrations') return chain([]);
      return noop;
    });
    await newService().runDeterministicScan(null);
    return upsertedRows(findings);
  }

  const duplicatesOf = (rows: Awaited<ReturnType<typeof scanWith>>, type: string) =>
    rows.filter((row) => row.finding_type === type);

  it('does not pair two members of the same club who share nothing else', async () => {
    const rows = await scanWith({
      persons: [
        { id: 'gp-1', given_name: 'Alice', family_name: 'Martin', clubs: { name: 'Lyon AMHE' } },
        { id: 'gp-2', given_name: 'Bruno', family_name: 'Petit', clubs: { name: 'Lyon AMHE' } },
      ],
    });

    expect(duplicatesOf(rows, 'global_person_duplicate')).toHaveLength(0);
  });

  it('still pairs on a shared ratings id alone', async () => {
    const rows = await scanWith({
      persons: [
        { id: 'gp-1', given_name: 'Alice', family_name: 'Martin', hema_ratings_id: '10458' },
        { id: 'gp-2', given_name: 'Bruno', family_name: 'Petit', hema_ratings_id: '10458' },
      ],
    });

    const dupes = duplicatesOf(rows, 'global_person_duplicate');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.evidence_json?.reasons).toEqual(['same_hema_ratings_id']);
  });

  it('still pairs on a shared claiming user alone', async () => {
    const rows = await scanWith({
      persons: [
        { id: 'gp-1', given_name: 'Alice', family_name: 'Martin', claimed_by_user_id: 'u-1' },
        { id: 'gp-2', given_name: 'Bruno', family_name: 'Petit', claimed_by_user_id: 'u-1' },
      ],
    });

    const dupes = duplicatesOf(rows, 'global_person_duplicate');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.evidence_json?.reasons).toEqual(['same_claimed_user']);
  });

  it('still pairs on a shared normalised name alone, and keeps the club as corroboration', async () => {
    const rows = await scanWith({
      persons: [
        { id: 'gp-1', given_name: 'Jean', family_name: 'Dupont', clubs: { name: 'Lyon AMHE' } },
        { id: 'gp-2', display_name: 'Jean  DUPONT', clubs: { name: 'lyon amhe' } },
      ],
    });

    const dupes = duplicatesOf(rows, 'global_person_duplicate');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.evidence_json?.reasons).toEqual(['same_normalized_name', 'same_club_name']);
  });

  it('does not pair a merged or soft-deleted person with its survivor', async () => {
    const rows = await scanWith({
      persons: [
        { id: 'gp-keep', given_name: 'Jean', family_name: 'Dupont' },
        { id: 'gp-merged', given_name: 'Jean', family_name: 'Dupont', merged_into_id: 'gp-keep' },
        { id: 'gp-gone', given_name: 'Jean', family_name: 'Dupont', deleted_at: '2026-01-01' },
      ],
    });

    expect(duplicatesOf(rows, 'global_person_duplicate')).toHaveLength(0);
  });

  it('reports a pair that matches two blocking keys exactly once', async () => {
    const rows = await scanWith({
      clubs: [
        { id: 'club-1', name: 'Lyon AMHE', abbreviation: 'LAMHE' },
        { id: 'club-2', name: 'lyon  amhe', abbreviation: 'lamhe' },
      ],
    });

    const dupes = duplicatesOf(rows, 'club_duplicate');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.evidence_json?.reasons).toEqual(['same_abbreviation', 'same_normalized_name']);
  });

  it('still pairs clubs on a shared abbreviation alone', async () => {
    const rows = await scanWith({
      clubs: [
        { id: 'club-1', name: 'Cercle des Armes', abbreviation: 'LAMHE' },
        { id: 'club-2', name: 'Escrime Ancienne', abbreviation: 'LAMHE' },
      ],
    });

    const dupes = duplicatesOf(rows, 'club_duplicate');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.evidence_json?.reasons).toEqual(['same_abbreviation']);
  });

  it('still pairs clubs on city, country and a similar name alone', async () => {
    // Same tokens in a different order: the normalised names differ, so
    // only the city+country bucket can bring this pair together.
    const rows = await scanWith({
      clubs: [
        { id: 'club-1', name: 'Lyon AMHE', city: 'Lyon', country_code: 'FR' },
        { id: 'club-2', name: 'AMHE Lyon', city: 'lyon', country_code: 'fr' },
      ],
    });

    const dupes = duplicatesOf(rows, 'club_duplicate');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.evidence_json?.reasons).toEqual(['same_city_country_similar_name']);
  });

  it('does not close a finding the AI cap never reached', async () => {
    // The reconcile pass keys on the FULL candidate set, not on the scan
    // id. Keying on the scan id would auto-resolve every real finding the
    // 100-call cap skipped — the cap fix and the auto-close destroying
    // each other in silence.
    const persons = Array.from({ length: 30 }, (_, i) => ({
      id: `gp-${i}`,
      given_name: 'Jean',
      family_name: 'Dupont',
      hema_ratings_id: '10458',
    }));
    const tables = (findings: ReturnType<typeof findingsTable>, scanId: string) => {
      const scanInsert = chain({ id: scanId });
      const noop = chain(null);
      return (table: string) => {
        if (table === 'ai_data_quality_scans') return scanInsert;
        if (table === 'ai_data_quality_findings') return findings;
        if (table === 'global_persons') return chain(persons);
        if (table === 'clubs') return chain([]);
        if (table === 'referee_qualifications') return chain([]);
        if (table === 'persons') return chain([]);
        if (table === 'registrations') return chain([]);
        return noop;
      };
    };

    const probe = findingsTable();
    fromMock.mockImplementation(tables(probe, 'scan-cap-probe'));
    await newService().runDeterministicScan(null);
    const allRows = upsertedRows(probe);
    expect(allRows.length).toBeGreaterThan(100);
    const beyondTheCap = allRows[allRows.length - 1]!.fingerprint;

    const capped = findingsTable([{ id: 'f-beyond', fingerprint: beyondTheCap, status: 'open' }]);
    fromMock.mockImplementation(tables(capped, 'scan-cap'));
    await newService().startScan('22222222-2222-4222-8222-222222222222');

    expect(capped.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' }));
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
