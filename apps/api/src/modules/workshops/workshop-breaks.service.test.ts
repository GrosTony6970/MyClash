/**
 * workshop-breaks.service.test.ts
 *
 * Pins the workshop-only break store:
 *   - createWorkshopBreak rejects end ≤ start.
 *   - createWorkshopBreak writes the snake_case columns (day_index,
 *     start_time, end_time, label).
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkshopsService } from './workshops.service';

type Resp = { data: unknown; error: { message: string } | null };

function buildSupabase(captures: Record<string, unknown[]>) {
  const eventsApi: Record<string, unknown> = {};
  Object.assign(eventsApi, {
    select: vi.fn(() => eventsApi),
    eq: vi.fn(() => eventsApi),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: { organization_id: 'org-1' }, error: null } as Resp),
    ),
  });
  const breaksApi: Record<string, unknown> = {};
  Object.assign(breaksApi, {
    insert: vi.fn((payload: unknown) => {
      (captures['insert'] ??= []).push(payload);
      return {
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: 'b-1' }, error: null } as Resp)),
        })),
      };
    }),
  });
  // Shape matches SupabaseService: the service reads `this.supabase.service.from`.
  return {
    service: {
      from: vi.fn((table: string) => (table === 'events' ? eventsApi : breaksApi)),
    },
  };
}

const makeSvc = (supabase: unknown) =>
  new WorkshopsService(
    supabase as never,
    { scheduleWorkshopSessionStarting: vi.fn() } as never,
    { workshopCancelled: vi.fn() } as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    { hiddenWorkshopGlobalPersonIds: vi.fn().mockResolvedValue(new Set<string>()) } as never,
  );

describe('WorkshopsService — workshop breaks', () => {
  it('rejects a break whose end is not after its start', async () => {
    const svc = makeSvc(buildSupabase({}));
    await expect(
      svc.createWorkshopBreak('event-1', { startTime: '13:00', endTime: '12:00' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inserts the snake_case columns for a valid break', async () => {
    const captures: Record<string, unknown[]> = {};
    const svc = makeSvc(buildSupabase(captures));

    await svc.createWorkshopBreak(
      'event-1',
      { dayIndex: 1, startTime: '12:00', endTime: '13:00', label: 'Lunch' },
      'user-1',
    );

    expect(captures['insert']?.[0]).toMatchObject({
      event_id: 'event-1',
      day_index: 1,
      start_time: '12:00',
      end_time: '13:00',
      label: 'Lunch',
    });
  });
});
