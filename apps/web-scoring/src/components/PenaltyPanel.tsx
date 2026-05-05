'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

type Card = 'yellow' | 'red' | 'black';
type FighterColor = 'red' | 'blue';

interface PenaltyEntry {
  id: string;
  group_number: number;
  ref_number: number;
  short_name: string;
  description: string;
  sanctions: Card[];
}

interface PenaltyRuleset {
  id: string;
  name: string;
  penalty_ruleset_entries?: PenaltyEntry[];
}

interface MatchPenalty {
  id: string;
  sequence: number;
  registration_id: string;
  card: Card;
  source: 'ruleset' | 'direct';
  short_name: string | null;
  reason: string | null;
  score_delta: number;
  causes_match_forfeit: boolean;
  voided: boolean;
}

export interface PenaltyPanelProps {
  matchId: string;
  nextSequence: number;
  redRegistrationId: string;
  blueRegistrationId: string;
  redName: string;
  blueName: string;
  apiUrl?: string;
  disabled?: boolean;
  onPenaltyRecorded?: () => void;
}

const cardClass: Record<Card, string> = {
  yellow: 'border-yellow-500 bg-yellow-100 text-yellow-900',
  red: 'border-red-500 bg-red-100 text-red-900',
  black: 'border-gray-950 bg-gray-950 text-white',
};

export function PenaltyPanel({
  matchId,
  nextSequence,
  redRegistrationId,
  blueRegistrationId,
  redName,
  blueName,
  apiUrl = 'http://localhost:4000',
  disabled = false,
  onPenaltyRecorded,
}: PenaltyPanelProps) {
  const { t } = useI18n();
  const [ruleset, setRuleset] = useState<PenaltyRuleset | null>(null);
  const [penalties, setPenalties] = useState<MatchPenalty[]>([]);
  const [fighter, setFighter] = useState<FighterColor>('red');
  const [query, setQuery] = useState('');
  const [directReason, setDirectReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedRegistrationId = fighter === 'red' ? redRegistrationId : blueRegistrationId;

  const entries = useMemo(
    () =>
      [...(ruleset?.penalty_ruleset_entries ?? [])].sort(
        (a, b) => a.group_number - b.group_number || a.ref_number - b.ref_number,
      ),
    [ruleset],
  );

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.short_name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        String(entry.ref_number).includes(q),
    );
  }, [entries, query]);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/matches/${matchId}/penalty-ruleset`, {
        signal: controller.signal,
        credentials: 'include',
      }),
      fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, {
        signal: controller.signal,
        credentials: 'include',
      }),
    ])
      .then(async ([rulesetRes, penaltiesRes]) => {
        if (rulesetRes.ok) setRuleset((await rulesetRes.json()) as PenaltyRuleset | null);
        if (penaltiesRes.ok) setPenalties((await penaltiesRes.json()) as MatchPenalty[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, matchId]);

  useEffect(() => refresh(), [refresh]);

  const submit = useCallback(
    async (payload: { rulesetEntryId?: string; directCard?: Card; reason?: string }) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            clientUuid: crypto.randomUUID(),
            sequence: nextSequence,
            registrationId: selectedRegistrationId,
            occurredAt: new Date().toISOString(),
            ...payload,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? t('scoring.penalties.recordError'));
        }
        setDirectReason('');
        refresh();
        onPenaltyRecorded?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('scoring.penalties.recordError'));
      } finally {
        setSubmitting(false);
      }
    },
    [apiUrl, matchId, nextSequence, onPenaltyRecorded, refresh, selectedRegistrationId, t],
  );

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-950 p-4 text-gray-100">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-200">
            {t('scoring.penalties.title')}
          </h2>
          <p className="text-xs text-gray-500">{ruleset?.name ?? t('common.loading')}</p>
        </div>
        <div className="flex rounded-lg border border-gray-700 p-1 text-xs">
          {(['red', 'blue'] as const).map((color) => (
            <button
              key={color}
              onClick={() => setFighter(color)}
              className={`rounded-md px-3 py-1 font-bold ${
                fighter === color
                  ? color === 'red'
                    ? 'bg-red-700 text-white'
                    : 'bg-blue-700 text-white'
                  : 'text-gray-400'
              }`}
              type="button"
            >
              {color === 'red' ? redName : blueName}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-900 px-3 py-2 text-xs text-red-100">{error}</p>
      )}

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('scoring.penalties.search')}
        className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-yellow-500"
      />

      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {filteredEntries.slice(0, 20).map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={disabled || submitting}
            onClick={() => void submit({ rulesetEntryId: entry.id })}
            className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left text-sm hover:border-yellow-600 disabled:opacity-40"
          >
            <span className="font-semibold text-gray-100">
              {entry.ref_number}. {entry.short_name}
            </span>
            <span className="ml-2 text-xs text-gray-500">
              {t('scoring.penalties.group')} {entry.group_number}
            </span>
            <span className="block truncate text-xs text-gray-500">{entry.description}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 border-t border-gray-800 pt-3">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('scoring.penalties.directCard')}
        </label>
        <input
          value={directReason}
          onChange={(event) => setDirectReason(event.target.value)}
          placeholder={t('scoring.penalties.directReason')}
          className="mb-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-yellow-500"
        />
        <div className="grid grid-cols-3 gap-2">
          {(['yellow', 'red', 'black'] as const).map((card) => (
            <button
              key={card}
              type="button"
              disabled={disabled || submitting || directReason.trim().length === 0}
              onClick={() => void submit({ directCard: card, reason: directReason })}
              className={`rounded-lg border px-3 py-2 text-xs font-black uppercase disabled:opacity-40 ${cardClass[card]}`}
            >
              {t(`scoring.penalties.cards.${card}`)}
            </button>
          ))}
        </div>
      </div>

      {penalties.some((penalty) => !penalty.voided) && (
        <ol className="mt-4 space-y-1 border-t border-gray-800 pt-3">
          {penalties
            .filter((penalty) => !penalty.voided)
            .slice()
            .reverse()
            .map((penalty) => (
              <li key={penalty.id} className="flex items-center justify-between text-xs">
                <span>
                  <span className={`mr-2 rounded border px-1.5 py-0.5 ${cardClass[penalty.card]}`}>
                    {t(`scoring.penalties.cards.${penalty.card}`)}
                  </span>
                  {penalty.short_name ?? penalty.reason ?? t('scoring.penalties.directCard')}
                </span>
                <span className="text-gray-500">
                  {penalty.score_delta !== 0 ? penalty.score_delta : ''}
                  {penalty.causes_match_forfeit ? t('scoring.penalties.matchForfeit') : ''}
                </span>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
