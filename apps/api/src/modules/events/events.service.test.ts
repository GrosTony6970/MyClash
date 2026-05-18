import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service';

const fromMock = vi.fn();
const assertOrgRole = vi.fn();

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  return chain;
}

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EventsService(
      { service: { from: fromMock } } as never,
      { assertOrgRole } as never,
      {} as never,
    );
  });

  it('hard deletes an event after org admin authorization', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
      error: null,
    });
    const deleteChain = makeChain({ data: null, error: null });
    fromMock.mockReturnValueOnce(eventChain).mockReturnValueOnce(deleteChain);
    assertOrgRole.mockResolvedValue(undefined);

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).resolves.toEqual({
      deleted: true,
      id: 'event-1',
    });
    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'event-1');
  });

  it('refuses event delete without explicit hard mode', async () => {
    await expect(service.deleteEvent('event-1', undefined, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('keeps org authorization failures fatal during hard delete', async () => {
    const eventChain = makeChain({
      data: { id: 'event-1', organization_id: 'org-1', status: 'draft' },
      error: null,
    });
    fromMock.mockReturnValueOnce(eventChain);
    assertOrgRole.mockRejectedValue(new ForbiddenException('Requires admin role or higher'));

    await expect(service.deleteEvent('event-1', 'hard', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
