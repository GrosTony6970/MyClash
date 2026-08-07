import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersService } from './admin-users.service';

const listAuthAdminUsers = vi.fn();
const createAuthAdminUser = vi.fn();
const getAuthAdminUser = vi.fn();
const updateAuthAdminUser = vi.fn();
const deleteAuthAdminUser = vi.fn();
const fromMock = vi.fn();

const mockSupabase = {
  listAuthAdminUsers,
  createAuthAdminUser,
  getAuthAdminUser,
  updateAuthAdminUser,
  deleteAuthAdminUser,
  service: {
    from: fromMock,
  },
};

function chain(result: unknown = { data: [], error: null }) {
  const state = {
    select: vi.fn(() => state),
    eq: vi.fn(() => state),
    in: vi.fn(() => state),
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
    service = new AdminUsersService(mockSupabase as never);
  });

  it('lists users through internal GoTrue admin API', async () => {
    listAuthAdminUsers.mockResolvedValue({
      ok: true,
      status: 200,
      data: { users: [{ id: 'user-1' }] },
      detail: {},
    });

    const result = await service.listUsers({ page: 2, perPage: 25, scope: 'all' });

    expect(listAuthAdminUsers).toHaveBeenCalledWith(2, 25);
    expect(result.users).toEqual([
      { id: 'user-1', display_name: null, organizations: [], is_super_admin: false },
    ]);
  });

  it('normalizes display names from Auth user metadata when listing accounts', async () => {
    listAuthAdminUsers.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        users: [
          {
            id: 'user-1',
            email: 'owner@example.com',
            user_metadata: { display_name: 'Owner One' },
          },
          {
            id: 'user-2',
            email: 'empty@example.com',
            user_metadata: { display_name: '   ' },
          },
        ],
      },
      detail: {},
    });

    const result = await service.listUsers({ scope: 'all' });

    expect(result.users).toEqual([
      expect.objectContaining({ id: 'user-1', display_name: 'Owner One' }),
      expect.objectContaining({ id: 'user-2', display_name: null }),
    ]);
  });

  it('searches platform accounts by display name, email, and user ID', async () => {
    listAuthAdminUsers.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        users: [
          {
            id: 'user-owner',
            email: 'owner@example.com',
            user_metadata: { display_name: 'Owner One' },
          },
          {
            id: 'user-ref',
            email: 'referee@example.com',
            user_metadata: { display_name: 'Referee Two' },
          },
          {
            id: 'user-other',
            email: 'other@example.com',
            user_metadata: { display_name: 'Other User' },
          },
        ],
      },
      detail: {},
    });

    const displayNameResult = await service.listUsers({ q: 'owner', perPage: 20, scope: 'all' });
    expect(displayNameResult.users).toEqual([
      expect.objectContaining({
        id: 'user-owner',
        email: 'owner@example.com',
        display_name: 'Owner One',
      }),
    ]);
    expect(listAuthAdminUsers).toHaveBeenCalledWith(1, 1000);

    listAuthAdminUsers.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        users: [
          { id: 'user-ref', email: 'referee@example.com', user_metadata: {} },
          { id: 'user-other', email: 'other@example.com', user_metadata: {} },
        ],
      },
      detail: {},
    });

    const emailResult = await service.listUsers({
      q: 'referee@example',
      perPage: 20,
      scope: 'all',
    });
    expect(emailResult.users).toEqual([expect.objectContaining({ id: 'user-ref' })]);

    listAuthAdminUsers.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        users: [
          { id: 'user-target-id', email: 'target@example.com', user_metadata: {} },
          { id: 'user-other', email: 'other@example.com', user_metadata: {} },
        ],
      },
      detail: {},
    });

    const idResult = await service.listUsers({ q: 'target-id', perPage: 20, scope: 'all' });
    expect(idResult.users).toEqual([expect.objectContaining({ id: 'user-target-id' })]);
  });

  it('restricts the staff scope to super-admins and org members', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_roles')
        return chain({ data: [{ user_id: 'user-super', created_at: '2026-01-01' }], error: null });
      if (table === 'organization_members')
        return chain({
          data: [
            {
              user_id: 'user-org',
              role: 'owner',
              organizations: { id: 'org-1', name: 'Org A', slug: 'org-a' },
            },
          ],
          error: null,
        });
      if (table === 'audit_log') return chain({ data: null, error: null });
      return chain({ data: [], error: null });
    });
    listAuthAdminUsers.mockResolvedValue({
      ok: true,
      status: 200,
      detail: {},
      data: {
        users: [
          { id: 'user-super', email: 'super@example.com' },
          { id: 'user-org', email: 'org@example.com' },
          { id: 'user-plain', email: 'plain@example.com' },
        ],
      },
    });

    const result = await service.listUsers({ scope: 'staff', perPage: 50 });

    const ids = result.users.map((u) => u.id);
    expect(ids).toContain('user-super');
    expect(ids).toContain('user-org');
    expect(ids).not.toContain('user-plain');
    expect(result.users).toHaveLength(2);
    expect(listAuthAdminUsers).toHaveBeenCalledWith(1, 1000);
  });

  it('returns every login under the all scope', async () => {
    listAuthAdminUsers.mockResolvedValue({
      ok: true,
      status: 200,
      detail: {},
      data: {
        users: [
          { id: 'user-super', email: 'super@example.com' },
          { id: 'user-org', email: 'org@example.com' },
          { id: 'user-plain', email: 'plain@example.com' },
        ],
      },
    });

    const result = await service.listUsers({ scope: 'all', perPage: 50 });

    expect(result.users.map((u) => u.id).sort()).toEqual(['user-org', 'user-plain', 'user-super']);
  });

  it('applies the search filter within the staff scope', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_roles')
        return chain({ data: [{ user_id: 'staff-owner', created_at: '2026-01-01' }], error: null });
      if (table === 'audit_log') return chain({ data: null, error: null });
      return chain({ data: [], error: null });
    });
    listAuthAdminUsers.mockResolvedValue({
      ok: true,
      status: 200,
      detail: {},
      data: {
        users: [
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
        ],
      },
    });

    const result = await service.listUsers({ scope: 'staff', q: 'owner', perPage: 20 });

    expect(result.users.map((u) => u.id)).toEqual(['staff-owner']);
  });

  it('derives the display name from OAuth metadata when display_name is unset', async () => {
    listAuthAdminUsers.mockResolvedValue({
      ok: true,
      status: 200,
      detail: {},
      data: {
        users: [
          {
            id: 'u-display',
            user_metadata: { display_name: 'Explicit Name', full_name: 'Ignored Name' },
          },
          { id: 'u-full', user_metadata: { full_name: 'Full Name' } },
          { id: 'u-name', user_metadata: { name: 'Name Only' } },
          { id: 'u-parts', user_metadata: { given_name: 'Jane', family_name: 'Doe' } },
          { id: 'u-none', user_metadata: {} },
        ],
      },
    });

    const result = await service.listUsers({ scope: 'all' });

    expect(result.users).toEqual([
      expect.objectContaining({ id: 'u-display', display_name: 'Explicit Name' }),
      expect.objectContaining({ id: 'u-full', display_name: 'Full Name' }),
      expect.objectContaining({ id: 'u-name', display_name: 'Name Only' }),
      expect.objectContaining({ id: 'u-parts', display_name: 'Jane Doe' }),
      expect.objectContaining({ id: 'u-none', display_name: null }),
    ]);
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

  it('grants super-admin role when requested during account creation', async () => {
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
      { email: 'new@example.com', makeSuperAdmin: true },
      'actor-user',
    );

    expect(platformRoles.upsert).toHaveBeenCalledWith(
      { user_id: 'user-new', role: 'super_admin' },
      { onConflict: 'user_id' },
    );
    expect(result.superAdminGranted).toBe(true);
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
