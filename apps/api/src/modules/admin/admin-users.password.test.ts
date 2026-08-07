import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersService } from './admin-users.service';

const getAuthAdminUser = vi.fn();
const updateAuthAdminUser = vi.fn();
const fromMock = vi.fn();
const generateLink = vi.fn();
const sendMagicLink = vi.fn().mockResolvedValue(undefined);
const auditInserts: Array<Record<string, unknown>> = [];
const vaultUpserts: Array<Record<string, unknown>> = [];

const mockSupabase = {
  getAuthAdminUser,
  updateAuthAdminUser,
  listAuthAdminUsers: vi.fn(),
  createAuthAdminUser: vi.fn(),
  deleteAuthAdminUser: vi.fn(),
  service: {
    from: fromMock,
    auth: { admin: { generateLink } },
  },
};

const mockMail = { sendMagicLink };
const mockConfig = { get: vi.fn(() => 'myclash.test') };

function chain(table: string) {
  const api: Record<string, unknown> = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    in: vi.fn(() => api),
    range: vi.fn(() => api),
    delete: vi.fn(() => api),
    update: vi.fn(() => api),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn((row: Record<string, unknown>) => {
      if (table === 'admin_user_temp_passwords') vaultUpserts.push(row);
      return Promise.resolve({ data: null, error: null });
    }),
    insert: vi.fn((row: Record<string, unknown>) => {
      if (table === 'audit_log') auditInserts.push(row);
      return Promise.resolve({ data: null, error: null });
    }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return api;
}

function auditFor(action: string) {
  return auditInserts.find((row) => row['action'] === action);
}

describe('AdminUsersService — admin-initiated password recovery', () => {
  let service: AdminUsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditInserts.length = 0;
    vaultUpserts.length = 0;
    fromMock.mockImplementation((table: string) => chain(table));
    service = new AdminUsersService(mockSupabase as never, mockMail as never, mockConfig as never);
  });

  describe('regenerateTempPassword', () => {
    it('vaults the POST-CHANGE updated_at, so the first reveal still works', async () => {
      // The trap this test exists for: revealTempPassword decides "the user has
      // set their own password" by comparing GoTrue's live updated_at against
      // the stored baseline. Storing the PRE-change timestamp makes the very
      // first reveal report password_changed and wipe the row the operator just
      // generated. GoTrue's PUT response does not carry the new timestamp, so
      // the service must read it back.
      updateAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        detail: {},
        data: { id: 'u1', updated_at: '2026-01-01T00:00:00.000Z' },
      });
      getAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        detail: {},
        data: { id: 'u1', updated_at: '2026-06-01T00:00:00.000Z' },
      });

      const result = await service.regenerateTempPassword('u1', 'actor-1');

      expect(result.status).toBe('active');
      expect(result.temporaryPassword).toEqual(expect.any(String));
      expect(vaultUpserts).toHaveLength(1);
      expect(vaultUpserts[0]).toMatchObject({
        user_id: 'u1',
        supabase_updated_at: '2026-06-01T00:00:00.000Z',
      });
    });

    it('sets the password it returns, and returns a fresh one each time', async () => {
      updateAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        detail: {},
        data: { id: 'u1' },
      });
      getAuthAdminUser.mockResolvedValue({ ok: true, status: 200, detail: {}, data: { id: 'u1' } });

      const first = await service.regenerateTempPassword('u1', 'actor-1');
      const second = await service.regenerateTempPassword('u1', 'actor-1');

      expect(updateAuthAdminUser).toHaveBeenNthCalledWith(1, 'u1', {
        password: first.temporaryPassword,
      });
      expect(second.temporaryPassword).not.toBe(first.temporaryPassword);
    });

    it('NEVER writes the password into the audit payload', async () => {
      // maskAuditPayload masks by key suffix (email/phone/dob/ip/user_agent).
      // There is no masker for a password, so one placed here lands in
      // audit_log in plaintext.
      updateAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        detail: {},
        data: { id: 'u1' },
      });
      getAuthAdminUser.mockResolvedValue({ ok: true, status: 200, detail: {}, data: { id: 'u1' } });

      const result = await service.regenerateTempPassword('u1', 'actor-1');

      const entry = auditFor('user.temp_password.regenerate');
      expect(entry).toBeDefined();
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(result.temporaryPassword);
      expect(serialized.toLowerCase()).not.toContain('password_plain');
      expect(entry?.['payload_json']).toEqual({});
    });

    it('refuses when GoTrue rejects the password change', async () => {
      updateAuthAdminUser.mockResolvedValue({ ok: false, status: 500, detail: {}, data: null });

      await expect(service.regenerateTempPassword('u1', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(vaultUpserts).toHaveLength(0);
    });
  });

  describe('sendPasswordReset', () => {
    it('generates a recovery link and mails it', async () => {
      getAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        detail: {},
        data: { id: 'u1', email: 'target@example.com' },
      });
      generateLink.mockResolvedValue({
        data: { properties: { action_link: 'https://link.example/recover' } },
        error: null,
      });

      await expect(service.sendPasswordReset('u1', 'actor-1')).resolves.toEqual({ sent: true });

      expect(generateLink).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'recovery', email: 'target@example.com' }),
      );
      expect(sendMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'target@example.com',
          magicLink: 'https://link.example/recover',
        }),
      );
    });

    it('audits with the target email, which the masker redacts by suffix', async () => {
      getAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        detail: {},
        data: { id: 'u1', email: 'target@example.com' },
      });
      generateLink.mockResolvedValue({
        data: { properties: { action_link: 'https://link.example/recover' } },
        error: null,
      });

      await service.sendPasswordReset('u1', 'actor-1');

      const entry = auditFor('user.password_reset.send');
      expect(entry).toBeDefined();
      // Masked on the way in — the key ends in `email`.
      expect(JSON.stringify(entry)).not.toContain('target@example.com');
    });

    it('does not mail anything when the link cannot be generated', async () => {
      getAuthAdminUser.mockResolvedValue({
        ok: true,
        status: 200,
        detail: {},
        data: { id: 'u1', email: 'target@example.com' },
      });
      generateLink.mockResolvedValue({ data: null, error: { message: 'nope' } });

      await expect(service.sendPasswordReset('u1', 'actor-1')).rejects.toThrow(BadRequestException);
      expect(sendMagicLink).not.toHaveBeenCalled();
    });

    it('refuses an account with no email on file', async () => {
      getAuthAdminUser.mockResolvedValue({ ok: true, status: 200, detail: {}, data: { id: 'u1' } });

      await expect(service.sendPasswordReset('u1', 'actor-1')).rejects.toThrow(BadRequestException);
      expect(generateLink).not.toHaveBeenCalled();
    });
  });
});

describe('AdminUsersService — platform role management', () => {
  let service: AdminUsersService;

  /** platform_roles rows the last-super-admin guard will count. */
  function withSuperAdmins(rows: Array<{ user_id: string }>) {
    fromMock.mockImplementation((table: string) => {
      const api = chain(table);
      if (table === 'platform_roles') {
        (api as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve);
      }
      return api;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    auditInserts.length = 0;
    fromMock.mockImplementation((table: string) => chain(table));
    getAuthAdminUser.mockResolvedValue({
      ok: true,
      status: 200,
      detail: {},
      data: { id: 'target-1', email: 'target@example.com' },
    });
    service = new AdminUsersService(mockSupabase as never, mockMail as never, mockConfig as never);
  });

  it.each(['super_admin', 'platform_admin', 'platform_viewer'] as const)(
    'sets the %s tier with one upsert on the primary key',
    async (role) => {
      withSuperAdmins([{ user_id: 'someone-else' }, { user_id: 'target-1' }]);

      await expect(service.setPlatformRole('target-1', role, 'actor-1')).resolves.toEqual({
        platformRole: role,
      });
      expect(auditFor('user.platform_role.set')).toBeDefined();
    },
  );

  it('refuses to demote the LAST super admin, not just to delete them', async () => {
    // Demoting the final super-admin locks the reserve out of its own platform
    // exactly as thoroughly as removing them, so the guard has to fire on a
    // change of tier and not only on a clear.
    withSuperAdmins([{ user_id: 'target-1' }]);

    await expect(service.setPlatformRole('target-1', 'platform_admin', 'actor-1')).rejects.toThrow(
      /last remaining super admin/i,
    );
  });

  it('still allows the last super admin to be re-set to super admin', async () => {
    withSuperAdmins([{ user_id: 'target-1' }]);

    await expect(service.setPlatformRole('target-1', 'super_admin', 'actor-1')).resolves.toEqual({
      platformRole: 'super_admin',
    });
  });

  it('refuses self-demotion', async () => {
    withSuperAdmins([{ user_id: 'actor-1' }, { user_id: 'other' }]);

    await expect(service.setPlatformRole('actor-1', 'platform_viewer', 'actor-1')).rejects.toThrow(
      /cannot demote yourself/i,
    );
  });

  it('clears a role and refuses to clear your own', async () => {
    withSuperAdmins([{ user_id: 'target-1' }, { user_id: 'actor-1' }]);
    await expect(service.clearPlatformRole('target-1', 'actor-1')).resolves.toEqual({
      platformRole: null,
    });
    expect(auditFor('user.platform_role.clear')).toBeDefined();

    await expect(service.clearPlatformRole('actor-1', 'actor-1')).rejects.toThrow(
      /your own platform role/i,
    );
  });

  it('refuses a tier change for an account that does not exist', async () => {
    getAuthAdminUser.mockResolvedValue({ ok: false, status: 404, detail: {}, data: null });

    await expect(service.setPlatformRole('ghost', 'platform_admin', 'actor-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
