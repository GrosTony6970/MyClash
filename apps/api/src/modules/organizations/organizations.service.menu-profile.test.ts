import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/organizations.dto';

/**
 * An organisation's sidebar profile (Everything / Workshops only): only the owner changes it, the
 * body names it `menuProfile`, the row stores it as `menu_profile`.
 */

const fromMock = vi.fn();
const service = new OrganizationsService({ service: { from: fromMock }, anon: {} } as never);

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const step of [chain.select, chain.eq, chain.update]) step.mockReturnValue(chain);
  return chain;
}

/** The caller's membership row, then the organisation write. */
function mockMember(role: string) {
  const membership = makeChain({ data: { role }, error: null });
  const write = makeChain({ data: { id: 'org-1' }, error: null });
  fromMock.mockReturnValueOnce(membership).mockReturnValueOnce(write);
  return write;
}

beforeEach(() => {
  fromMock.mockReset();
});

describe('OrganizationsService.update — the sidebar profile', () => {
  it('writes menuProfile to menu_profile', async () => {
    const write = mockMember('owner');
    await service.update('org-1', { menuProfile: 'workshops' }, 'user-1');
    expect(fromMock).toHaveBeenLastCalledWith('organizations');
    expect(write.update).toHaveBeenCalledWith(
      expect.objectContaining({ menu_profile: 'workshops' }),
    );
  });

  it('leaves menu_profile alone when the body has no menuProfile', async () => {
    const write = mockMember('owner');
    await service.update('org-1', { name: 'Amiens AMHE' }, 'user-1');
    expect(write.update.mock.calls[0]?.[0]).not.toHaveProperty('menu_profile');
  });

  it('refuses an admin: only the owner changes the sidebar', async () => {
    const write = mockMember('admin');
    await expect(service.update('org-1', { menuProfile: 'workshops' }, 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(write.update).not.toHaveBeenCalled();
  });

  it('accepts everything and workshops and refuses any other value', () => {
    const schema = UpdateOrganizationDto.schema;
    expect(schema.safeParse({ menuProfile: 'everything' }).success).toBe(true);
    expect(schema.safeParse({ menuProfile: 'workshops' }).success).toBe(true);
    expect(schema.safeParse({ menuProfile: 'tournament' }).success).toBe(false);
  });
});
