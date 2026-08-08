import { describe, expect, it, vi } from 'vitest';
import { PassEmailService } from './pass-email.service';
import { supabaseChain, type ChainResult } from '../../common/testing/supabase-chain';

const EVENT = 'event-1';
const USER = 'user-1';

const CLARA = { id: 'p1', given_name: 'Clara', family_name: 'Roux', email: 'clara@example.test' };
const OMAR = { id: 'p2', given_name: 'Omar', family_name: 'Diallo', email: 'omar@example.test' };
const NO_EMAIL = { id: 'p3', given_name: 'Jo', family_name: 'Lane', email: null };

/**
 * `from()` routed by table, but `events` is asked TWICE with the same shape
 * (once for the org check, once for the name/slug) and `persons` once — so a
 * single row object answering every `events` call is both correct and stable
 * against a query being added upstream. The ordered-mock desync this avoids is
 * a known defect class here.
 */
function supabaseFor(opts: { roster?: unknown[]; existingPasses?: Array<{ person_id: string }> }) {
  const passes = supabaseChain({ data: opts.existingPasses ?? [], error: null });
  const byTable: Record<string, ChainResult> = {
    events: { data: { organization_id: 'org-1', name: 'FAL 2026', slug: 'fal-2026' }, error: null },
    persons: { data: opts.roster ?? [], error: null },
  };
  const from = vi.fn((table: string) => {
    if (table === 'event_passes') return passes;
    if (table === 'audit_log') return supabaseChain({ data: null, error: null });
    const result = byTable[table];
    if (!result) throw new Error(`unconfigured table "${table}"`);
    return supabaseChain(result);
  });
  return { service: { from }, from, passes };
}

function deps(overrides: { issue?: unknown; send?: unknown } = {}) {
  const issue = overrides.issue ?? vi.fn(() => Promise.resolve({ token: 'raw', expiresAt: null }));
  const send = overrides.send ?? vi.fn(() => Promise.resolve());
  return {
    pass: { issue },
    mail: { sendEventPass: send },
    orgs: { assertOrgRole: vi.fn(() => Promise.resolve()) },
    config: { get: vi.fn(() => 'myclash.fr') },
    issue,
    send,
  };
}

function build(supabase: ReturnType<typeof supabaseFor>, d: ReturnType<typeof deps> = deps()) {
  return {
    service: new PassEmailService(
      supabase as never,
      d.pass as never,
      d.mail as never,
      d.orgs as never,
      d.config as never,
    ),
    d,
  };
}

describe('PassEmailService authorization', () => {
  it('requires org editor — mailing a credential to the roster is an organiser act', async () => {
    const supabase = supabaseFor({ roster: [] });
    const { service, d } = build(supabase);

    await service.mailPasses(EVENT, USER, false);

    expect(d.orgs.assertOrgRole).toHaveBeenCalledWith('org-1', USER, 'editor');
  });

  it('refuses before issuing anything when the role check throws', async () => {
    const supabase = supabaseFor({ roster: [CLARA] });
    const d = deps();
    d.orgs.assertOrgRole = vi.fn(() => Promise.reject(new Error('Requires editor role or higher')));
    const { service } = build(supabase, d);

    await expect(service.mailPasses(EVENT, USER, false)).rejects.toThrow(/editor/i);
    expect(d.issue).not.toHaveBeenCalled();
  });
});

describe('PassEmailService.mailPasses', () => {
  it('mails every unclaimed entry that has an address', async () => {
    const supabase = supabaseFor({ roster: [CLARA, OMAR] });
    const { service, d } = build(supabase);

    const result = await service.mailPasses(EVENT, USER, false);

    expect(result.sent).toBe(2);
    expect(d.send).toHaveBeenCalledTimes(2);
  });

  it('counts entries with no address instead of failing on them', async () => {
    // The desk finds these people by name; they are not an error.
    const supabase = supabaseFor({ roster: [CLARA, NO_EMAIL] });
    const { service, d } = build(supabase);

    const result = await service.mailPasses(EVENT, USER, false);

    expect(result).toMatchObject({ sent: 1, withoutEmail: 1 });
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('SKIPS anyone who already holds a pass, so a second mail-out cannot kill live links', async () => {
    // Issuing replaces the previous token. Adding three fighters on the Friday
    // must not retire the link every Thursday recipient is already holding.
    const supabase = supabaseFor({
      roster: [CLARA, OMAR],
      existingPasses: [{ person_id: CLARA.id }],
    });
    const { service, d } = build(supabase);

    const result = await service.mailPasses(EVENT, USER, false);

    expect(result).toMatchObject({ sent: 1, skipped: 1 });
    expect(d.issue).toHaveBeenCalledTimes(1);
    expect(d.issue).toHaveBeenCalledWith(EVENT, OMAR.id, 'email');
  });

  it('re-issues to everyone only when resend is explicitly asked for', async () => {
    const supabase = supabaseFor({
      roster: [CLARA, OMAR],
      existingPasses: [{ person_id: CLARA.id }, { person_id: OMAR.id }],
    });
    const { service, d } = build(supabase);

    const result = await service.mailPasses(EVENT, USER, true);

    expect(result).toMatchObject({ sent: 2, skipped: 0 });
    expect(d.issue).toHaveBeenCalledTimes(2);
  });

  it('issues with via=email, so the two delivery paths stay comparable', async () => {
    const supabase = supabaseFor({ roster: [CLARA] });
    const { service, d } = build(supabase);

    await service.mailPasses(EVENT, USER, false);

    expect(d.issue).toHaveBeenCalledWith(EVENT, CLARA.id, 'email');
  });

  it('sends a link carrying the RAW token, on the public app host', async () => {
    const supabase = supabaseFor({ roster: [CLARA] });
    const { service, d } = build(supabase);

    await service.mailPasses(EVENT, USER, false);

    expect(d.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'clara@example.test',
        passUrl: 'https://app.myclash.fr/e/fal-2026/pass?t=raw',
      }),
    );
  });

  it('names the addresses that failed instead of abandoning the roster', async () => {
    // One bad address must not cost the other 299 people their pass.
    const send = vi.fn((opts: { to: string }) =>
      opts.to === CLARA.email ? Promise.reject(new Error('bounced')) : Promise.resolve(),
    );
    const supabase = supabaseFor({ roster: [CLARA, OMAR] });
    const { service } = build(supabase, deps({ send }));

    const result = await service.mailPasses(EVENT, USER, false);

    expect(result.sent).toBe(1);
    expect(result.failed).toEqual([CLARA.email]);
  });

  it('writes an audit entry — mailing credentials to a roster is an auditable act', async () => {
    const supabase = supabaseFor({ roster: [CLARA] });
    const { service } = build(supabase);

    await service.mailPasses(EVENT, USER, false);

    expect(supabase.from.mock.calls.map(([table]) => table)).toContain('audit_log');
  });
});
