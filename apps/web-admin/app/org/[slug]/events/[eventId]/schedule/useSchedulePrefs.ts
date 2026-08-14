'use client';

import { type Dispatch, type SetStateAction, useCallback, useSyncExternalStore } from 'react';
import { zoomToSlotHeight } from '@myclash/schedule-core';
import { PANEL_DEFAULT_WIDTH, clampPanelWidth } from './panel-width';

/**
 * The four schedule-board preferences that survive a reload: whether the side
 * panel is collapsed, how wide it is, the vertical zoom, and the hall filter.
 *
 * WHY useSyncExternalStore. These were four `useState` defaults plus eight
 * effects — one to read localStorage on mount and one to write it back on
 * change — and every read effect needed an `eslint-disable
 * react-hooks/set-state-in-effect`. The effect was not laziness: reading
 * localStorage during render would make the server's HTML and the client's
 * first render disagree, so the value had to arrive one render late. An
 * external store says the same thing without lying to the linter: the server
 * snapshot is the default, the client snapshot is what is stored, and React
 * reconciles the difference itself.
 *
 * localStorage IS the state here. There is no mirrored copy that can drift from
 * it, and a functional updater reads the stored value rather than a closure, so
 * two changes in the same tick cannot lose one.
 *
 * Snapshots are primitives (boolean, number, string), compared by value — so
 * unlike the object-valued store in `src/components/event-nav-groups.ts` this
 * one needs no reference caching to stay stable across renders. Don't add it.
 */

const PANEL_COLLAPSED_KEY = 'myclash.schedule.panelCollapsed';
const PANEL_WIDTH_KEY = 'myclash.schedule.panelWidth';
const ZOOM_KEY = 'myclash.schedule.zoom';
const VENUE_FILTER_KEY = 'myclash.schedule.venueFilter';

/**
 * Slot height the board opens at, a touch taller than the base slot so block
 * cards have room for the tournament / pool / fight-count / time lines. A
 * stored preference overrides it.
 */
const DEFAULT_SLOT_HEIGHT = zoomToSlotHeight(22);

/**
 * How one preference crosses the string boundary.
 *
 * `parse` returns `null` for "stored but unusable" — an empty string, a
 * non-number, a non-positive width — and the caller falls back to the default.
 * That reproduces the guards the old read effects carried (`if (stored)`,
 * `Number.isFinite(stored) && stored > 0`).
 *
 * Both numeric parsers run the stored value back through the same clamp the
 * writer used. Those clamps are idempotent (`clampPanelWidth` is a bare
 * min/max, `zoomToSlotHeight` is a clamped round), so a value round-trips to
 * itself — which is what lets the store hold the rendered pixel height rather
 * than a separate zoom level.
 */
export interface PrefCodec<T> {
  key: string;
  fallback: T;
  parse: (raw: string) => T | null;
  serialize: (value: T) => string;
}

export const panelCollapsedCodec: PrefCodec<boolean> = {
  key: PANEL_COLLAPSED_KEY,
  fallback: false,
  parse: (raw) => raw === '1',
  serialize: (value) => (value ? '1' : '0'),
};

export const panelWidthCodec: PrefCodec<number> = {
  key: PANEL_WIDTH_KEY,
  fallback: PANEL_DEFAULT_WIDTH,
  parse: (raw) => {
    const stored = Number(raw);
    return Number.isFinite(stored) && stored > 0 ? clampPanelWidth(stored) : null;
  },
  serialize: (value) => String(value),
};

export const zoomCodec: PrefCodec<number> = {
  key: ZOOM_KEY,
  fallback: DEFAULT_SLOT_HEIGHT,
  parse: (raw) => {
    const stored = Number(raw);
    return Number.isFinite(stored) && stored > 0 ? zoomToSlotHeight(stored) : null;
  },
  serialize: (value) => String(value),
};

export const venueFilterCodec: PrefCodec<string> = {
  key: VENUE_FILTER_KEY,
  fallback: 'all',
  parse: (raw) => raw || null,
  serialize: (value) => value,
};

// --- the store -------------------------------------------------------------

const listenersByKey = new Map<string, Set<() => void>>();

function listenersFor(key: string): Set<() => void> {
  const existing = listenersByKey.get(key);
  if (existing) return existing;
  const created = new Set<() => void>();
  listenersByKey.set(key, created);
  return created;
}

/** Read one preference straight out of storage. */
function readPref<T>(codec: PrefCodec<T>): T {
  if (typeof window === 'undefined') return codec.fallback;
  const raw = window.localStorage.getItem(codec.key);
  if (raw === null) return codec.fallback;
  return codec.parse(raw) ?? codec.fallback;
}

function writePref<T>(codec: PrefCodec<T>, value: T): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(codec.key, codec.serialize(value));
  // `storage` only fires in OTHER tabs, so this tab notifies its own readers.
  for (const listener of listenersFor(codec.key)) listener();
}

function usePersistedPref<T>(codec: PrefCodec<T>): [T, Dispatch<SetStateAction<T>>] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const listeners = listenersFor(codec.key);
      listeners.add(onChange);
      window.addEventListener('storage', onChange);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onChange);
      };
    },
    [codec.key],
  );
  const getSnapshot = useCallback(() => readPref(codec), [codec]);
  const getServerSnapshot = useCallback(() => codec.fallback, [codec.fallback]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      // Resolve a functional updater against storage, not against a captured
      // render value — two updates in one tick then cannot lose the first.
      const next =
        typeof action === 'function' ? (action as (prev: T) => T)(readPref(codec)) : action;
      writePref(codec, next);
    },
    [codec],
  );
  return [value, setValue];
}

export interface SchedulePrefs {
  /** The Unscheduled + Configure side panel is retractable, visible by default. */
  panelCollapsed: boolean;
  setPanelCollapsed: Dispatch<SetStateAction<boolean>>;
  /** Sidebar width in px (drag-to-resize on lg+). */
  panelWidth: number;
  setPanelWidth: Dispatch<SetStateAction<number>>;
  /** Vertical zoom: rendered slot height in px. Slot math stays 5-min. */
  slotHeightPx: number;
  setSlotHeightPx: Dispatch<SetStateAction<number>>;
  /** Per-hall filter for the block board: 'all' | venueId | 'none'. */
  venueFilter: string;
  setVenueFilter: Dispatch<SetStateAction<string>>;
}

/** Read/persist the schedule board's four operator preferences. */
export function useSchedulePrefs(): SchedulePrefs {
  const [panelCollapsed, setPanelCollapsed] = usePersistedPref(panelCollapsedCodec);
  const [panelWidth, setPanelWidth] = usePersistedPref(panelWidthCodec);
  const [slotHeightPx, setSlotHeightPx] = usePersistedPref(zoomCodec);
  const [venueFilter, setVenueFilter] = usePersistedPref(venueFilterCodec);
  return {
    panelCollapsed,
    setPanelCollapsed,
    panelWidth,
    setPanelWidth,
    slotHeightPx,
    setSlotHeightPx,
    venueFilter,
    setVenueFilter,
  };
}
