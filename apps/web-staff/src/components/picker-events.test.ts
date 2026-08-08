import { describe, expect, it } from 'vitest';
import {
  defaultPickerTab,
  partitionPickerEvents,
  resolveSelectedEvent,
  type PickerEvent,
} from './picker-events';

function event(over: Partial<PickerEvent> & { id: string }): PickerEvent {
  return {
    slug: `slug-${over.id}`,
    name: `Event ${over.id}`,
    startDate: '2026-08-08',
    status: 'published',
    kind: 'standard',
    ...over,
  };
}

describe('partitionPickerEvents', () => {
  it('splits on status, not on the tablet clock', () => {
    // A tablet with a wrong clock is the failure 0172 exists to record, so the
    // Live/Upcoming split must not depend on the device's idea of "now". Both
    // events below carry dates that a naive date comparison would misfile.
    const events = [
      event({ id: 'a', status: 'running', startDate: '2020-01-01' }),
      event({ id: 'b', status: 'published', startDate: '2020-01-01' }),
    ];

    const { live, upcoming } = partitionPickerEvents(events);

    expect(live.map((e) => e.id)).toEqual(['a']);
    expect(upcoming.map((e) => e.id)).toEqual(['b']);
  });

  it('files drafts and dateless events under upcoming rather than dropping them', () => {
    const events = [event({ id: 'draft', status: 'draft', startDate: null })];

    const { live, upcoming } = partitionPickerEvents(events);

    expect(live).toEqual([]);
    expect(upcoming.map((e) => e.id)).toEqual(['draft']);
  });
});

describe('defaultPickerTab', () => {
  it('opens on Live when something is live', () => {
    expect(defaultPickerTab(partitionPickerEvents([event({ id: 'a', status: 'running' })]))).toBe(
      'live',
    );
  });

  it('opens on Upcoming when nothing is live, so the first tab is never empty', () => {
    expect(defaultPickerTab(partitionPickerEvents([event({ id: 'a', status: 'published' })]))).toBe(
      'upcoming',
    );
  });

  it('opens on Upcoming when there is nothing at all', () => {
    // Both tabs are empty; Upcoming is the one whose empty copy makes sense.
    expect(defaultPickerTab(partitionPickerEvents([]))).toBe('upcoming');
  });
});

describe('resolveSelectedEvent', () => {
  const events = [event({ id: 'a' }), event({ id: 'b' })];

  it('pre-selects the remembered event when it is still listed', () => {
    expect(resolveSelectedEvent(events, null, 'b')?.id).toBe('b');
  });

  it('selects nothing when the remembered event is NOT in the list', () => {
    // The tablet-carried-to-a-different-venue case. Pre-selecting an event
    // that is not on screen would arm the form with an invisible answer, so a
    // stale memory must resolve to no selection and force a deliberate tap.
    expect(resolveSelectedEvent(events, null, 'yesterday')).toBeNull();
  });

  it('lets an explicit tap override the remembered event', () => {
    expect(resolveSelectedEvent(events, event({ id: 'a' }), 'b')?.id).toBe('a');
  });

  it('selects nothing when there is no memory and no tap', () => {
    // A first-time tablet must not default to whatever happens to be first:
    // signing into the wrong event is precisely what the picker prevents.
    expect(resolveSelectedEvent(events, null, null)).toBeNull();
  });
});
