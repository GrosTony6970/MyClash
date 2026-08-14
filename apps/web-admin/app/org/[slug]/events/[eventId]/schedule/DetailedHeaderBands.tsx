'use client';

import { useI18n } from '@myclash/next-i18n/client';
import {
  LICE_HEADER_HEIGHT_PX,
  VENUE_HEADER_HEIGHT_PX,
  computeVenueGroups,
  venueColor,
} from '@myclash/schedule-core';
import type { Lice } from './schedule-types';

/**
 * The Detailed view's two frozen rows: the venue band, then the lice names.
 *
 * Both are placed on explicit grid coordinates rather than flowing, because the
 * match cards below are absolutely placed and auto-flow would let a dropped
 * fight push a header out of its column.
 *
 * The venue band groups consecutive same-venue lice columns into one cell, so
 * it is not a per-lice row — that is why it cannot be folded into the lice
 * header loop.
 */

interface Props {
  visibleLices: Lice[];
  /** Org slug — the venue cell links to the org's Venues tab. */
  slug: string;
  onPlaceLice: (lice: Lice) => void;
}

export function DetailedHeaderBands({ visibleLices, slug, onPlaceLice }: Props) {
  const { t } = useI18n();
  return (
    <>
      <div
        className="sticky top-0 z-30 bg-surface border-b border-border"
        style={{ gridColumn: 1, gridRow: 1, height: VENUE_HEADER_HEIGHT_PX }}
      />
      {computeVenueGroups(visibleLices).map((group, groupIndex) => {
        const startCol = group.startIndex + 2;
        if (group.venueId) {
          const tint = venueColor(group.venueId);
          return (
            <a
              key={`${group.venueId}-${groupIndex}`}
              href={`/org/${slug}/venues`}
              className="sticky top-0 z-30 border-b border-l border-l-border px-2 flex items-center justify-center text-sm font-semibold truncate hover:brightness-95"
              style={{
                gridColumn: `${startCol} / span ${group.span}`,
                gridRow: 1,
                height: VENUE_HEADER_HEIGHT_PX,
                ...(tint ?? {}),
              }}
              title={group.venueName ?? ''}
            >
              {group.venueName}
            </a>
          );
        }
        return (
          <div
            key={`no-venue-${groupIndex}`}
            className="sticky top-0 z-30 bg-border border-b border-border border-l border-l-border px-2 flex items-center justify-center text-sm italic text-muted truncate"
            style={{
              gridColumn: `${startCol} / span ${group.span}`,
              gridRow: 1,
              height: VENUE_HEADER_HEIGHT_PX,
            }}
          >
            {t('organizer.schedulePage.blockGrid.noVenue')}
          </div>
        );
      })}

      {/* Row 2: corner cell + one cell per lice. Its sticky `top` matches the
          venue band's height so it parks directly under it on scroll. */}
      <div
        className="sticky bg-surface border-b border-border"
        style={{ gridColumn: 1, gridRow: 2, top: VENUE_HEADER_HEIGHT_PX, zIndex: 20 }}
      />
      {visibleLices.map((lice, liceIndex) => (
        <div
          key={lice.id}
          className="sticky bg-surface border-b border-border border-l border-l-border px-2 flex items-center justify-center gap-1"
          style={{
            gridColumn: liceIndex + 2,
            gridRow: 2,
            top: VENUE_HEADER_HEIGHT_PX,
            zIndex: 20,
            height: LICE_HEADER_HEIGHT_PX,
          }}
        >
          <span className="text-xs font-bold text-foreground-secondary truncate">{lice.name}</span>
          {/* The only way to place a lice after the event wizard has run —
              PATCH /lices/:id had no caller before this. */}
          <button
            type="button"
            onClick={() => onPlaceLice(lice)}
            title={t('organizer.schedulePage.placement.editLabel')}
            aria-label={t('organizer.schedulePage.placement.editLabel')}
            className="shrink-0 text-xs text-muted hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent rounded"
          >
            ⌖
          </button>
        </div>
      ))}
    </>
  );
}
