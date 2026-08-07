import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersService } from './admin-users.service';

const listAuthAdminUsers = vi.fn();
const createAuthAdminUser = vi.fn();
const getAuthAdminUser = vi.fn();
const updateAuthAdminUser = vi.fn();
const deleteAuthAdminUser = vi.fn();
const fromMock = vi.fn();

const sendMagicLink = vi.fn().mockResolvedValue(undefined);
const generateLink = vi.fn();
const mockMail = { sendMagicLink };
const mockConfig = { get: vi.fn(() => 'myclash.test') };

const mockSupabase = {
  listAuthAdminUsers,
  createAuthAdminUser,
  getAuthAdminUser,
  updateAuthAdminUser,
  deleteAuthAdminUser,
  service: {
    from: fromMock,
    auth: { admin: { generateLink } },
  },
};

function chain(result: unknown = { data: [], error: null }) {
  const state = {
    select: vi.fn(() => state),
    eq: vi.fn(() => state),
    in: vi.fn(() => state),
    // fetchAllOrgMemberUserIds pages explicitly now. The fake returns the whole
    // set on the first range and the loop stops because it is a short page.
    range: vi.fn(() => state),
    maybeSingle: vi.fn().mockResolvedValue(result),
    upsert: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockResolvedValue(result),
    delete: vi.fn(() => state),
    update: vi.fn(() => state),
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return state;
}

function setupDefaultDb() {
  fromMock.mockImplementation((table: string) => {
    if (table === 'audit_log') return chain({ data: null, error: null });
    if (table === 'platform_roles') return chain({ data: [], error: null });
    return chain({ data: [], error: null });
  });
}

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultDb();
    service = new AdminUsersService(mockSupabase as never, mockMail as never, mockConfig as never);
  });

  // ── Listing ───────────────────────────────────────────────────────────────
  //
  // The three scopes are PREDICATES, not a partition: an account holding both a
  // platform role and an org membership appears under `platform` AND
  // `organizer`. Only `user` is defined by absence.

  function authUsers(users: Array<Record<string, unknown>>) {
    listAuthAdminUsers.mockResolvedValue({ ok: true, status: 200, detail: {}, data: { users } });
  }

  /** platform_roles rows + organization_members rows, keyed by table. */
  function db(opts: {
    platformRoles?: Array<{ user_id: string; role: string }>;
    orgMembers?: Array<Record<string, unknown>>;
  }) {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_roles') return chain({ data: opts.platformRoles ?? [], error: null });
      if (table === 'organization_members')
        return chain({ data: opts.orgMembers ?? [], error: null });
      if (table === 'audit_log') return chain({ data: null, error: null });
      return chain({ data: [], error: null });
    });
  }

  it('lists the platform scope from platform_roles, without enumerating Auth', async () => {
    // The whole point of the platform short-circuit: twelve platform accounts
    // must not cost an enumeration of ten thousand logins.
    db({ platformRoles: [{ user_id: 'user-super', role: 'super_admin' }] });
    getAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      detail: {},
      data: { id: 'user-super', email: 'super@example.com' },
    });

    const result = await service.listUsers({ scope: 'platform' });

    expect(listAuthAdminUsers).not.toHaveBeenCalled();
    expect(result.users).toEqual([
      expect.objectContaining({ id: 'user-super', platform_role: 'super_admin' }),
    ]);
    expect(result.total).toBe(1);
  });

  it('reports each tier verbatim on the platform scope', async () => {
    db({
      platformRoles: [
        { user_id: 'u-super', role: 'super_admin' },
        { user_id: 'u-admin', role: 'platform_admin' },
        { user_id: 'u-view', role: 'platform_viewer' },
      ],
    });
    getAuthAdminUser.mockImplementation((id: string) =>
      Promise.resolve({ ok: true, status: 200, detail: {}, data: { id, email: `${id}@e.com` } }),
    );

    const result = await service.listUsers({ scope: 'platform' });

    expect(Object.fromEntries(result.users.map((u) => [u.id, u.platform_role]))).toEqual({
      'u-super': 'super_admin',
      'u-admin': 'platform_admin',
      'u-view': 'platform_viewer',
    });
  });

  it('skips a platform_roles row whose auth user is gone rather than failing the listing', async () => {
    // Orphaned rows are exactly what an operator opens this console to clean
    // up; refusing the whole page over one would be the worst possible moment.
    db({
      platformRoles: [
        { user_id: 'u-live', role: 'platform_admin' },
        { user_id: 'u-ghost', role: 'platform_viewer' },
      ],
    });
    getAuthAdminUser.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'u-live'
          ? { ok: true, status: 200, detail: {}, data: { id, email: 'live@e.com' } }
          : { ok: false, status: 404, detail: {}, data: null },
      ),
    );

    const result = await service.listUsers({ scope: 'platform' });

    expect(result.users.map((u) => u.id)).toEqual(['u-live']);
    expect(result.total).toBe(1);
  });

  it('lists the organizer scope from org memberships', async () => {
    db({
      platformRoles: [],
      orgMembers: [
        {
          user_id: 'user-org',
          role: 'owner',
          organizations: { id: 'org-1', name: 'Org A', slug: 'org-a' },
        },
      ],
    });
    authUsers([
      { id: 'user-org', email: 'org@example.com' },
      { id: 'user-plain', email: 'plain@example.com' },
    ]);

    const result = await service.listUsers({ scope: 'organizer' });

    expect(result.users.map((u) => u.id)).toEqual(['user-org']);
    expect(result.users[0]?.organizations).toEqual([
      { id: 'org-1', name: 'Org A', slug: 'org-a', role: 'owner' },
    ]);
  });

  it('defines the user scope by absence — neither an organiser nor platform staff', async () => {
    db({
      platformRoles: [{ user_id: 'user-super', role: 'super_admin' }],
      orgMembers: [{ user_id: 'user-org', role: 'owner', organizations: { id: 'o', slug: 'o' } }],
    });
    authUsers([
      { id: 'user-super', email: 'super@example.com' },
      { id: 'user-org', email: 'org@example.com' },
      { id: 'user-plain', email: 'plain@example.com' },
    ]);

    const result = await service.listUsers({ scope: 'user' });

    expect(result.users.map((u) => u.id)).toEqual(['user-plain']);
    expect(result.users[0]?.platform_role).toBeNull();
  });

  it('shows a dual account under BOTH the platform and organizer scopes', async () => {
    // The owner is a platform super-admin AND runs their own club. The scopes
    // overlap on purpose; a partition would put this account in no tab at all.
    const dual = { user_id: 'user-dual', role: 'super_admin' };
    const membership = {
      user_id: 'user-dual',
      role: 'owner',
      organizations: { id: 'org-1', name: 'Lyon AMHE', slug: 'lyon-amhe' },
    };
    db({ platformRoles: [dual], orgMembers: [membership] });
    getAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      detail: {},
      data: { id: 'user-dual', email: 'dual@example.com' },
    });
    authUsers([{ id: 'user-dual', email: 'dual@example.com' }]);

    const platform = await service.listUsers({ scope: 'platform' });
    const organizer = await service.listUsers({ scope: 'organizer' });
    const user = await service.listUsers({ scope: 'user' });

    expect(platform.users.map((u) => u.id)).toEqual(['user-dual']);
    expect(organizer.users.map((u) => u.id)).toEqual(['user-dual']);
    // ...and NOT under `user`, which is the everyone-else tab.
    expect(user.users).toEqual([]);
  });

  it('reports the pre-paging total, not the page length', async () => {
    db({ platformRoles: [], orgMembers: [] });
    authUsers(Array.from({ length: 7 }, (_, i) => ({ id: `u-${i}`, email: `u${i}@example.com` })));

    const result = await service.listUsers({ scope: 'user', page: 2, perPage: 3 });

    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(3);
    expect(result.users.map((u) => u.id)).toEqual(['u-3', 'u-4', 'u-5']);
  });

  it('clamps perPage — the page hydrates org rows, so it cannot be unbounded', async () => {
    db({ platformRoles: [], orgMembers: [] });
    authUsers(Array.from({ length: 150 }, (_, i) => ({ id: `u-${i}`, email: `u${i}@e.com` })));

    const result = await service.listUsers({ scope: 'user', perPage: 5000 });

    expect(result.perPage).toBe(100);
    expect(result.users).toHaveLength(100);
  });

  it('pages org memberships past the PostgREST 1000-row cap', async () => {
    // The previous implementation issued a bare select() and relied on the
    // default cap, so past a thousand memberships organisers silently vanished
    // from the listing — no error, no warning, just absent rows.
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({ user_id: `org-${i}` }));
    const secondPage = [{ user_id: 'org-1000' }];
    let call = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_roles') return chain({ data: [], error: null });
      if (table === 'organization_members') {
        call += 1;
        if (call === 1) return chain({ data: firstPage, error: null });
        if (call === 2) return chain({ data: secondPage, error: null });
        return chain({ data: [], error: null });
      }
      if (table === 'audit_log') return chain({ data: null, error: null });
      return chain({ data: [], error: null });
    });
    authUsers([{ id: 'org-1000', email: 'late@example.com' }]);

    const result = await service.listUsers({ scope: 'organizer' });

    // Reachable only if the second range() page was fetched.
    expect(result.users.map((u) => u.id)).toEqual(['org-1000']);
  });

  it('searches by display name, email and user id within a scope', async () => {
    db({ platformRoles: [], orgMembers: [] });
    authUsers([
      {
        id: 'user-owner',
        email: 'owner@example.com',
        user_metadata: { display_name: 'Owner One' },
      },
      { id: 'user-ref', email: 'referee@example.com', user_metadata: { display_name: 'Ref Two' } },
      { id: 'user-target-id', email: 'other@example.com', user_metadata: {} },
    ]);

    expect((await service.listUsers({ scope: 'user', q: 'owner' })).users.map((u) => u.id)).toEqual(
      ['user-owner'],
    );
    expect(
      (await service.listUsers({ scope: 'user', q: 'referee@example' })).users.map((u) => u.id),
    ).toEqual(['user-ref']);
    expect(
      (await service.listUsers({ scope: 'user', q: 'target-id' })).users.map((u) => u.id),
    ).toEqual(['user-target-id']);
    // Enumerates in 1000-row pages, never at the caller's perPage.
    expect(listAuthAdminUsers).toHaveBeenCalledWith(1, 1000);
  });

  it('narrows the search to the scope, not the whole account table', async () => {
    db({
      platformRoles: [],
      orgMembers: [
        { user_id: 'staff-owner', role: 'owner', organizations: { id: 'o', slug: 'o' } },
      ],
    });
    authUsers([
      {
        id: 'staff-owner',
        email: 'owner@example.com',
        user_metadata: { display_name: 'Owner Staff' },
      },
      {
        id: 'public-owner',
        email: 'owner2@example.com',
        user_metadata: { display_name: 'Owner Public' },
      },
    ]);

    const result = await service.listUsers({ scope: 'organizer', q: 'owner' });

    expect(result.users.map((u) => u.id)).toEqual(['staff-owner']);
  });

  it('derives the display name from OAuth metadata when display_name is unset', async () => {
    db({ platformRoles: [], orgMembers: [] });
    authUsers([
      { id: 'u-display', user_metadata: { display_name: 'Explicit Name', full_name: 'Ignored' } },
      { id: 'u-full', user_metadata: { full_name: 'Full Name' } },
      { id: 'u-name', user_metadata: { name: 'Name Only' } },
      { id: 'u-parts', user_metadata: { given_name: 'Jane', family_name: 'Doe' } },
      { id: 'u-none', user_metadata: {} },
    ]);

    const result = await service.listUsers({ scope: 'user' });

    expect(Object.fromEntries(result.users.map((u) => [u.id, u.display_name]))).toEqual({
      'u-display': 'Explicit Name',
      'u-full': 'Full Name',
      'u-name': 'Name Only',
      'u-parts': 'Jane Doe',
      'u-none': null,
    });
  });

  it('creates confirmed users and returns a one-time temporary password', async () => {
    createAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-new', email: 'new@example.com' },
      detail: {},
    });

    const result = await service.createPlatformUser(
      { email: 'New@Example.com', displayName: 'New User' },
      'actor-user',
    );

    expect(createAuthAdminUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@example.com',
        email_confirm: true,
        user_metadata: { display_name: 'New User' },
      }),
    );
    expect(result.user).toEqual({ id: 'user-new', email: 'new@example.com', created: true });
    expect(result.temporaryPassword).toEqual(expect.any(String));
    expect(result.temporaryPassword.length).toBeGreaterThan(20);
  });

  it.each(['super_admin', 'platform_admin', 'platform_viewer'] as const)(
    'grants the %s tier when requested during account creation',
    async (role) => {
      const platformRoles = chain({ data: null, error: null });
      fromMock.mockImplementation((table: string) =>
        table === 'platform_roles' ? platformRoles : chain({ data: null, error: null }),
      );
      createAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        data: { id: 'user-new', email: 'new@example.com' },
        detail: {},
      });

      const result = await service.createPlatformUser(
        { email: 'new@example.com', platformRole: role },
        'actor-user',
      );

      expect(platformRoles.upsert).toHaveBeenCalledWith(
        { user_id: 'user-new', role },
        { onConflict: 'user_id' },
      );
      expect(result.platformRole).toBe(role);
    },
  );

  it('creates a plain account when no tier is requested', async () => {
    const platformRoles = chain({ data: null, error: null });
    fromMock.mockImplementation((table: string) =>
      table === 'platform_roles' ? platformRoles : chain({ data: null, error: null }),
    );
    createAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-new', email: 'new@example.com' },
      detail: {},
    });

    const result = await service.createPlatformUser({ email: 'new@example.com' }, 'actor-user');

    expect(platformRoles.upsert).not.toHaveBeenCalled();
    expect(result.platformRole).toBeNull();
  });

  it('disables and enables users through internal GoTrue update helpers', async () => {
    updateAuthAdminUser.mockResolvedValue({ ok: true, status: 200, data: { id: 'user-1' } });

    await service.disableUser('user-1', 'actor-user');
    await service.enableUser('user-1', 'actor-user');

    expect(updateAuthAdminUser).toHaveBeenNthCalledWith(1, 'user-1', {
      ban_duration: '876000h',
    });
    expect(updateAuthAdminUser).toHaveBeenNthCalledWith(2, 'user-1', {
      ban_duration: 'none',
    });
  });

  it('safe-deletes an unused account', async () => {
    deleteAuthAdminUser.mockResolvedValue({ ok: true, status: 200, data: null });

    const result = await service.deletePlatformUser('user-unused', 'actor-user', 'safe');

    expect(deleteAuthAdminUser).toHaveBeenCalledWith('user-unused');
    expect(result).toEqual({ deleted: true, mode: 'safe', cleanupApplied: false });
  });

  it('refuses safe deletion when app references exist', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'persons') return chain({ data: [{ id: 'person-1' }], error: null });
      return chain({ data: [], error: null });
    });

    await expect(service.deletePlatformUser('user-linked', 'actor-user', 'safe')).rejects.toThrow(
      BadRequestException,
    );
    expect(deleteAuthAdminUser).not.toHaveBeenCalled();
  });

  it('cleanup-deletes supported private references before deleting Auth user', async () => {
    const persons = chain({ data: [], error: null });
    const globalPersons = chain({ data: [], error: null });
    deleteAuthAdminUser.mockResolvedValue({ ok: true, status: 200, data: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'persons') return persons;
      if (table === 'global_persons') return globalPersons;
      return chain({ data: [], error: null });
    });

    await service.deletePlatformUser('user-linked', 'actor-user', 'cleanup');

    expect(persons.update).toHaveBeenCalledWith({
      claimed_by_user_id: null,
      claim_status: 'unclaimed',
    });
    expect(globalPersons.update).toHaveBeenCalledWith({ claimed_by_user_id: null });
    expect(deleteAuthAdminUser).toHaveBeenCalledWith('user-linked');
  });

  /**
   * The production bug, as reported: a freshly created account attached to
   * nothing still failed to delete. Referee tables carry no user_id since
   * migration 0063, and PostgREST rejects an unknown column at PLAN time — so
   * the blocker sweep threw before it ever looked at a row, for every account.
   */
  it('deletes an account that references nothing without ever naming a referee user_id', async () => {
    const refereeQualifications = chain({ data: [], error: null });
    deleteAuthAdminUser.mockResolvedValue({ ok: true, status: 200, data: null });
    fromMock.mockImplementation((table: string) =>
      table === 'referee_qualifications' ? refereeQualifications : chain({ data: [], error: null }),
    );

    const result = await service.deletePlatformUser('user-fresh', 'actor-user', 'safe');

    expect(result).toEqual({ deleted: true, mode: 'safe', cleanupApplied: false });
    // No claimed global person ⇒ nothing can reference it, so the table is not
    // queried at all. It must certainly never be filtered on `user_id`.
    expect(refereeQualifications.eq).not.toHaveBeenCalled();
    expect(refereeQualifications.in).not.toHaveBeenCalled();
  });

  it('counts referee qualifications through the claimed global person, not the uid', async () => {
    const globalPersons = chain({ data: [{ id: 'gp-1' }], error: null });
    const refereeQualifications = chain({ data: [{ person_id: 'gp-1' }], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'global_persons') return globalPersons;
      if (table === 'referee_qualifications') return refereeQualifications;
      return chain({ data: [], error: null });
    });

    await expect(service.deletePlatformUser('user-ref', 'actor-user', 'safe')).rejects.toThrow(
      BadRequestException,
    );

    expect(refereeQualifications.select).toHaveBeenCalledWith('person_id');
    expect(refereeQualifications.in).toHaveBeenCalledWith('person_id', ['gp-1']);
    expect(deleteAuthAdminUser).not.toHaveBeenCalled();
  });

  /**
   * `workshop_enrollments.user_id` holds an event-scoped persons.id, not a uid.
   * Compared against the uid it matched nothing, silently — enrollments never
   * blocked a delete and were never reported.
   */
  it('counts workshop enrollments through claimed persons, not the uid', async () => {
    const persons = chain({ data: [{ id: 'person-1' }], error: null });
    const enrollments = chain({ data: [{ user_id: 'person-1' }], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'persons') return persons;
      if (table === 'workshop_enrollments') return enrollments;
      return chain({ data: [], error: null });
    });

    await expect(service.deletePlatformUser('user-ws', 'actor-user', 'safe')).rejects.toThrow(
      BadRequestException,
    );

    expect(enrollments.in).toHaveBeenCalledWith('user_id', ['person-1']);
    expect(enrollments.eq).not.toHaveBeenCalledWith('user_id', 'user-ws');
  });

  /**
   * "Historical event facts remain" is the button's own promise. Cleanup clears
   * private links and unlinks the identity; it must not delete event records.
   */
  it('cleanup never deletes historical event facts', async () => {
    const refereeQualifications = chain({ data: [], error: null });
    const enrollments = chain({ data: [], error: null });
    const platformRoles = chain({ data: [], error: null });
    deleteAuthAdminUser.mockResolvedValue({ ok: true, status: 200, data: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'referee_qualifications') return refereeQualifications;
      if (table === 'workshop_enrollments') return enrollments;
      if (table === 'platform_roles') return platformRoles;
      return chain({ data: [], error: null });
    });

    await service.deletePlatformUser('user-linked', 'actor-user', 'cleanup');

    expect(refereeQualifications.delete).not.toHaveBeenCalled();
    expect(enrollments.delete).not.toHaveBeenCalled();
    // The private links still go.
    expect(platformRoles.delete).toHaveBeenCalled();
    expect(deleteAuthAdminUser).toHaveBeenCalledWith('user-linked');
  });

  // ── Temp-password vault ────────────────────────────────────────────────────

  it('vaults the temp password on create so super-admin can reveal it later', async () => {
    const tempVault = chain({ data: null, error: null });
    fromMock.mockImplementation((table: string) =>
      table === 'admin_user_temp_passwords' ? tempVault : chain({ data: null, error: null }),
    );
    createAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-new', email: 'new@example.com', updated_at: '2026-05-26T12:00:00Z' },
      detail: {},
    });

    const result = await service.createPlatformUser({ email: 'new@example.com' }, 'actor-user');

    expect(tempVault.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-new',
        password: result.temporaryPassword,
        supabase_updated_at: '2026-05-26T12:00:00Z',
      }),
      { onConflict: 'user_id' },
    );
  });

  it('reveals the temp password when Supabase updated_at has not moved', async () => {
    const tempVault = chain({
      data: {
        password: 'stored-temp',
        supabase_updated_at: '2026-05-26T12:00:00Z',
      },
      error: null,
    });
    fromMock.mockImplementation((table: string) =>
      table === 'admin_user_temp_passwords' ? tempVault : chain({ data: null, error: null }),
    );
    getAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-new', updated_at: '2026-05-26T12:00:00Z' },
      detail: {},
    });

    const result = await service.revealTempPassword('user-new', 'actor-user');

    expect(result).toEqual({ status: 'active', password: 'stored-temp' });
  });

  it('still reveals the temp password months later when the user has not changed it', async () => {
    // Migration 0093 dropped the wall-clock TTL on the vault row;
    // operators kept hitting "Locked — temp password expired" when
    // the user took longer than 7 days to take delivery. The vault
    // row no longer carries an `expires_at`; reveal now depends
    // only on the Supabase updated_at comparison.
    const tempVault = chain({
      data: {
        password: 'stored-temp',
        supabase_updated_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    fromMock.mockImplementation((table: string) =>
      table === 'admin_user_temp_passwords' ? tempVault : chain({ data: null, error: null }),
    );
    getAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-new', updated_at: '2026-01-01T00:00:00Z' },
      detail: {},
    });

    const result = await service.revealTempPassword('user-new', 'actor-user');

    expect(result).toEqual({ status: 'active', password: 'stored-temp' });
  });

  it('wipes the vault and returns password_changed when Supabase updated_at has moved', async () => {
    const tempVault = chain({
      data: {
        password: 'stored-temp',
        supabase_updated_at: '2026-05-26T12:00:00Z',
      },
      error: null,
    });
    fromMock.mockImplementation((table: string) =>
      table === 'admin_user_temp_passwords' ? tempVault : chain({ data: null, error: null }),
    );
    getAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: 'user-new', updated_at: '2026-05-27T00:00:00Z' },
      detail: {},
    });

    const result = await service.revealTempPassword('user-new', 'actor-user');

    expect(result).toEqual({ status: 'password_changed' });
    expect(tempVault.delete).toHaveBeenCalled();
  });

  it('returns expired when no vault row exists', async () => {
    const tempVault = chain({ data: null, error: null });
    fromMock.mockImplementation((table: string) =>
      table === 'admin_user_temp_passwords' ? tempVault : chain({ data: null, error: null }),
    );

    await expect(service.revealTempPassword('user-new', 'actor-user')).resolves.toEqual({
      status: 'expired',
    });
  });

  it('manual lock deletes the vault row and returns locked', async () => {
    const tempVault = chain({ data: null, error: null });
    fromMock.mockImplementation((table: string) =>
      table === 'admin_user_temp_passwords' ? tempVault : chain({ data: null, error: null }),
    );

    await expect(service.lockTempPassword('user-new', 'actor-user')).resolves.toEqual({
      status: 'locked',
    });
    expect(tempVault.delete).toHaveBeenCalled();
  });

  it('blocks deleting the current actor and the last super admin', async () => {
    await expect(service.deletePlatformUser('actor-user', 'actor-user', 'safe')).rejects.toThrow(
      BadRequestException,
    );

    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_roles') {
        return chain({ data: [{ user_id: 'last-admin', created_at: 'now' }], error: null });
      }
      return chain({ data: [], error: null });
    });

    await expect(service.deletePlatformUser('last-admin', 'actor-user', 'safe')).rejects.toThrow(
      BadRequestException,
    );
  });
});
