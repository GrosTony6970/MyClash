'use client';

import { useEffect, useRef, useState } from 'react';

interface Lice {
  id: string;
  name: string;
  sortOrder: number;
}

interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentName: string | null;
  durationMinutes: number;
}

interface Conflict {
  matchA: string;
  matchB: string;
  personName: string;
  time: string;
}

const SLOT_MINUTES = 5;
const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const TOTAL_SLOTS = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES;
const SLOT_WIDTH_PX = 40;

function minutesToSlot(minutes: number): number {
  return Math.floor(minutes / SLOT_MINUTES);
}

function slotToTime(slot: number, baseDate: string): string {
  const base = new Date(baseDate);
  base.setHours(GRID_START_HOUR, 0, 0, 0);
  base.setMinutes(base.getMinutes() + slot * SLOT_MINUTES);
  return base.toISOString();
}

function isoToSlot(iso: string, baseDate: string): number {
  const base = new Date(baseDate);
  base.setHours(GRID_START_HOUR, 0, 0, 0);
  const diff = (new Date(iso).getTime() - base.getTime()) / 60_000;
  return Math.max(0, minutesToSlot(diff));
}

function formatSlotTime(slot: number): string {
  const totalMin = GRID_START_HOUR * 60 + slot * SLOT_MINUTES;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function detectConflicts(matches: ScheduleMatch[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const scheduled = matches.filter((m) => m.scheduledAt && m.liceId);

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]!;
      const b = scheduled[j]!;
      const aFighters = [a.redRegistrationId, a.blueRegistrationId];
      const bFighters = [b.redRegistrationId, b.blueRegistrationId];
      const shared = aFighters.filter((f) => bFighters.includes(f));
      if (shared.length === 0) continue;
      const aStart = new Date(a.scheduledAt!).getTime();
      const aEnd = aStart + a.durationMinutes * 60_000;
      const bStart = new Date(b.scheduledAt!).getTime();
      const bEnd = bStart + b.durationMinutes * 60_000;
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({
          matchA: a.matchNumberLabel,
          matchB: b.matchNumberLabel,
          personName:
            shared[0] === a.redRegistrationId
              ? (a.redFighterName ?? shared[0]!)
              : (a.blueFighterName ?? shared[0]!),
          time: new Date(a.scheduledAt!).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        });
      }
    }
  }
  return conflicts;
}

export function ScheduleGrid({ slug, eventId }: { slug: string; eventId: string }) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [lices, setLices] = useState<Lice[]>([]);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [baseDate, setBaseDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const dragMatch = useRef<ScheduleMatch | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/schedule`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([licesRes, schedRes, eventRes]) => {
        setLoading(false);
        if (licesRes.ok) {
          const l = (await licesRes.json()) as Lice[];
          setLices(l.sort((a, b) => a.sortOrder - b.sortOrder));
        }
        if (schedRes.ok) {
          const m = (await schedRes.json()) as ScheduleMatch[];
          setMatches(m);
          setConflicts(detectConflicts(m));
        }
        if (eventRes.ok) {
          const ev = (await eventRes.json()) as { startDate: string };
          setBaseDate(ev.startDate);
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl]);

  async function saveMatchPosition(matchId: string, liceId: string, scheduledAt: string) {
    setSaving(matchId);
    try {
      await fetch(`${apiUrl}/api/v1/matches/${matchId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ liceId, scheduledAt }),
      });
    } finally {
      setSaving(null);
    }
  }

  function handleDrop(liceId: string, slot: number) {
    const match = dragMatch.current;
    if (!match || !baseDate) return;
    const newScheduledAt = slotToTime(slot, baseDate);
    const updated = matches.map((m) =>
      m.id === match.id ? { ...m, liceId, scheduledAt: newScheduledAt } : m,
    );
    setMatches(updated);
    setConflicts(detectConflicts(updated));
    void saveMatchPosition(match.id, liceId, newScheduledAt);
    dragMatch.current = null;
  }

  const unscheduled = matches.filter((m) => !m.scheduledAt || !m.liceId);
  const scheduled = matches.filter((m) => m.scheduledAt && m.liceId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {baseDate && (
        <div className="flex justify-end mb-4">
          <input
            type="date"
            value={baseDate}
            onChange={(e) => setBaseDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-6 text-sm">
          <p className="font-bold text-red-700 mb-1">
            ⚠ {conflicts.length} scheduling conflict{conflicts.length !== 1 ? 's' : ''}
          </p>
          <ul className="list-disc list-inside text-red-600 space-y-0.5">
            {conflicts.map((c, i) => (
              <li key={i}>
                <strong>{c.personName}</strong> is in both <em>{c.matchA}</em> and{' '}
                <em>{c.matchB}</em> at {c.time}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-6">
        {/* Unscheduled sidebar */}
        <div className="w-48 flex-shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            Unscheduled ({unscheduled.length})
          </h2>
          <div
            className="flex flex-col gap-1.5 min-h-[100px] border-2 border-dashed border-gray-200 rounded-xl p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const match = dragMatch.current;
              if (!match) return;
              const updated = matches.map((m) =>
                m.id === match.id ? { ...m, liceId: null, scheduledAt: null } : m,
              );
              setMatches(updated);
              setConflicts(detectConflicts(updated));
              void saveMatchPosition(match.id, '', '');
              dragMatch.current = null;
            }}
          >
            {unscheduled.map((m) => (
              <MatchChip
                key={m.id}
                match={m}
                saving={saving === m.id}
                onDragStart={() => {
                  dragMatch.current = m;
                }}
              />
            ))}
          </div>
        </div>

        {/* Day grid */}
        <div className="flex-1 overflow-x-auto">
          {lices.length === 0 ? (
            <p className="text-gray-400 text-sm">No Lices configured for this event.</p>
          ) : (
            <div>
              <div className="flex mb-1 ml-24">
                {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
                  if (i % 12 !== 0) return null;
                  return (
                    <div
                      key={i}
                      className="text-xs text-gray-400 flex-shrink-0"
                      style={{ width: SLOT_WIDTH_PX * 12, minWidth: SLOT_WIDTH_PX * 12 }}
                    >
                      {formatSlotTime(i)}
                    </div>
                  );
                })}
              </div>
              {lices.map((lice) => {
                const liceMatches = scheduled.filter((m) => m.liceId === lice.id);
                return (
                  <div key={lice.id} className="flex items-stretch mb-1">
                    <div className="w-24 flex-shrink-0 flex items-center pr-2">
                      <span className="text-xs font-bold text-gray-700 truncate">{lice.name}</span>
                    </div>
                    <div
                      className="relative bg-gray-50 border border-gray-200 rounded-lg"
                      style={{
                        width: TOTAL_SLOTS * SLOT_WIDTH_PX,
                        minWidth: TOTAL_SLOTS * SLOT_WIDTH_PX,
                        height: 48,
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const slot = Math.floor(x / SLOT_WIDTH_PX);
                        handleDrop(lice.id, Math.max(0, Math.min(TOTAL_SLOTS - 1, slot)));
                      }}
                    >
                      {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 border-l border-gray-200"
                          style={{ left: i * 12 * SLOT_WIDTH_PX }}
                        />
                      ))}
                      {liceMatches.map((m) => {
                        const slot = isoToSlot(m.scheduledAt!, baseDate || m.scheduledAt!);
                        const width = Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES));
                        const hasConflict = conflicts.some(
                          (c) => c.matchA === m.matchNumberLabel || c.matchB === m.matchNumberLabel,
                        );
                        return (
                          <div
                            key={m.id}
                            draggable
                            onDragStart={() => {
                              dragMatch.current = m;
                            }}
                            className={[
                              'absolute top-1 bottom-1 rounded text-xs font-medium px-1 flex items-center cursor-grab active:cursor-grabbing overflow-hidden',
                              hasConflict
                                ? 'bg-red-200 border border-red-400 text-red-800'
                                : 'bg-blue-100 border border-blue-300 text-blue-800',
                              saving === m.id ? 'opacity-50' : '',
                            ].join(' ')}
                            style={{
                              left: slot * SLOT_WIDTH_PX,
                              width: width * SLOT_WIDTH_PX - 2,
                            }}
                            title={`${m.matchNumberLabel}: ${m.redFighterName ?? '?'} vs ${m.blueFighterName ?? '?'}`}
                          >
                            <span className="truncate">{m.matchNumberLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchChip({
  match,
  saving,
  onDragStart,
}: {
  match: ScheduleMatch;
  saving: boolean;
  onDragStart: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={[
        'border border-gray-300 rounded-lg px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing bg-white hover:border-gray-400 transition-colors',
        saving ? 'opacity-50' : '',
      ].join(' ')}
    >
      <p className="font-medium text-gray-900 truncate">{match.matchNumberLabel}</p>
      <p className="text-gray-400 truncate">
        {match.redFighterName ?? '?'} vs {match.blueFighterName ?? '?'}
      </p>
    </div>
  );
}
