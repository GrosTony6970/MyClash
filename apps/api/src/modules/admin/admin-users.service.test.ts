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

    const result = await service.listUsers({ page: 2, perPage: 25 });

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

    const result = await service.listUsers();

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

    const displayNameResult = await service.listUsers({ q: 'owner', perPage: 20 });
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

    const emailResult = await service.listUsers({ q: 'referee@example', perPage: 20 });
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

    const idResult = await service.listUsers({ q: 'target-id', perPage: 20 });
    expect(idResult.users).toEqual([expect.objectContaining({ id: 'user-target-id' })]);
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
