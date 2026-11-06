import { describe, expect, it } from 'vitest';
import { getMessages } from '@myclash/i18n';
import type { PhotoMode } from '@myclash/types';
import { HUB_TAB_LABEL, hubTabPath, hubTabs } from './hub-tabs';
import type { MyEvent } from './types';

/**
 * The tabs of one Event in her personal space, the hub's strip and the sidebar's links alike: the
 * Photos tab shows when the Event shows photos or she has sent some there (design, "Where it
 * shows up" item 5).
 */

function myEvent(photoMode: PhotoMode | null, hasMyPhotos: boolean): MyEvent {
  return { event: { slug: 'lyon', photoMode }, hasMyPhotos } as unknown as MyEvent;
}

describe('the hub tabs', () => {
  it.each(['live', 'approve'] as const)(
    'end with Photos when the Event shows photos (%s)',
    (mode) => {
      expect(hubTabs(myEvent(mode, false))).toEqual([
        'overview',
        'schedule',
        'workshops',
        'photos',
      ]);
    },
  );

  it('leave Photos out when photos are Off and none of hers are there', () => {
    expect(hubTabs(myEvent('off', false))).toEqual(['overview', 'schedule', 'workshops']);
  });

  it('keep Photos when photos are Off but she has photos there', () => {
    expect(hubTabs(myEvent('off', true))).toEqual(['overview', 'schedule', 'workshops', 'photos']);
  });

  it('leave Photos out for a mode this build does not know, unless she has photos there', () => {
    expect(hubTabs(myEvent(null, false))).toEqual(['overview', 'schedule', 'workshops']);
    expect(hubTabs(myEvent(null, true))).toContain('photos');
  });

  it('open Overview at the Event itself and every other tab below it', () => {
    expect(hubTabPath('lyon', 'overview')).toBe('/me/events/lyon');
    expect(hubTabPath('lyon', 'schedule')).toBe('/me/events/lyon/schedule');
    expect(hubTabPath('lyon', 'photos')).toBe('/me/events/lyon/photos');
  });

  it('name every tab with a key that exists in English and French', () => {
    // A key held in a map is no `t('…')` call: the key sweep checks it is used, not that it exists.
    for (const locale of ['en', 'fr'] as const) {
      const messages = getMessages(locale) as unknown as Record<string, unknown>;
      for (const key of Object.values(HUB_TAB_LABEL)) {
        const value = key.split('.').reduce<unknown>((node, part) => {
          return typeof node === 'object' && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined;
        }, messages);
        expect(typeof value, `${locale} ${key}`).toBe('string');
      }
    }
  });
});
