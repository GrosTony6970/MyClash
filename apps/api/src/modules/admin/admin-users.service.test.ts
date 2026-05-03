import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersService } from './admin-users.service';

const listUsers = vi.fn();
const updateUserById = vi.fn();
const fromMock = vi.fn();

const mockSupabase = {
  service: {
    auth: { admin: { listUsers, updateUserById } },
    from: fromMock,
  },
};

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    service = new AdminUsersService(mockSupabase as never);
  });

  it('lists users through Supabase admin API', async () => {
    listUsers.mockResolvedValue({ data: { users: [{ id: 'user-1' }] }, error: null });

    const result = await service.listUsers({ page: 2, perPage: 25 });

    expect(listUsers).toHaveBeenCalledWith({ page: 2, perPage: 25 });
    expect(result.users).toEqual([{ id: 'user-1' }]);
  });

  it('disables users with a long auth ban and writes audit log', async () => {
    updateUserById.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await service.disableUser('user-1', 'actor-user');

    expect(updateUserById).toHaveBeenCalledWith('user-1', { ban_duration: '876000h' });
    expect(fromMock).toHaveBeenCalledWith('audit_log');
  });

  it('enables users by clearing the auth ban', async () => {
    updateUserById.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    await service.enableUser('user-1', 'actor-user');

    expect(updateUserById).toHaveBeenCalledWith('user-1', { ban_duration: 'none' });
  });

  it('throws BadRequestException when Supabase admin update fails', async () => {
    updateUserById.mockResolvedValue({ data: null, error: { message: 'auth failed' } });

    await expect(service.disableUser('user-1', 'actor-user')).rejects.toThrow(BadRequestException);
  });
});
