'use client';

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

interface Tournament {
  id: string;
  name: string;
}

interface ToolResult {
  render_hint: 'table' | 'list' | 'card' | 'comparison' | 'summary_stats' | 'empty';
  title: string;
  columns?: string[];
  rows?: Array<Record<string, string | number>>;
  items?: Array<{ label: string; value: string | number }>;
  card?: Record<string, string | number>;
  comparison?: { entities: string[]; metrics: Record<string, Array<string | number>> };
  metadata: {
    tool_name: string;
    arguments: Record<string, unknown>;
    notes?: string[];
  };
}

interface QueryResponse {
  kind: 'result' | 'clarification' | 'refusal';
  language: 'en' | 'fr';
  toolCalled?: string;
  result?: ToolResult;
  summary?: string;
  message?: string;
  costEur: number;
  totalSpendEur: number;
}

interface Estimate {
  estimatedCostEur: number;
  currentSpend: number;
  cap: number | null;
  allowed: boolean;
}

interface QueryHistoryItem {
  question: string;
  summary: string | null;
  cost_eur: number;
  created_at: string;
}

interface Settings {
  accessPolicy: string;
  rateLimitPerHour: number;
}

const SUGGESTION_KEYS = [
  'topWinRateEn',
  'topWinRateFr',
  'licesBehindEn',
  'licesBehindFr',
  'poolRemainingEn',
  'poolRemainingFr',
  'onScheduleEn',
  'onScheduleFr',
  'laggingRefsEn',
  'laggingRefsFr',
] as const;

export function TournamentQueryPanel(props: { apiUrl: string; tournaments: Tournament[] }) {
  const { apiUrl, tournaments } = props;
  const { t } = useI18n();
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [question, setQuestion] = useState('');
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [settings, setSettings] = useState<Settings>({
    accessPolicy: 'organizers_only',
    rateLimitPerHour: 60,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const activeTournamentId = selectedTournamentId || tournaments[0]?.id || '';

  useEffect(() => {
    if (!activeTournamentId || question.trim().length < 4) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${apiUrl}/api/v1/tournaments/${activeTournamentId}/query/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ question }),
      })
        .then(async (res) => {
          if (res.ok) setEstimate((await res.json()) as Estimate);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, activeTournamentId, question]);

  useEffect(() => {
    if (!activeTournamentId) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${activeTournamentId}/query/history`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/tournaments/${activeTournamentId}/query/settings`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([historyRes, settingsRes]) => {
        if (historyRes.ok) {
          const body = (await historyRes.json()) as { queries: QueryHistoryItem[] };
          setHistory(body.queries.slice(0, 5));
        }
        if (settingsRes.ok) setSettings((await settingsRes.json()) as Settings);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, activeTournamentId]);

  const suggestions = useMemo(
    () => SUGGESTION_KEYS.map((key) => t(`organizer.tournamentQuery.suggestions.${key}`)),
    [t],
  );

  async function askQuestion(nextQuestion = question) {
    if (!activeTournamentId || nextQuestion.trim().length < 4) return;
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${activeTournamentId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ question: nextQuestion }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.tournamentQuery.queryError'));
      }
      setResponse((await res.json()) as QueryResponse);
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournamentQuery.queryError'));
    } finally {
      setBusy(false);
    }
  }

  async function refreshHistory() {
    const res = await fetch(`${apiUrl}/api/v1/tournaments/${activeTournamentId}/query/history`, {
      credentials: 'include',
    });
    if (res.ok) {
      const body = (await res.json()) as { queries: QueryHistoryItem[] };
      setHistory(body.queries.slice(0, 5));
    }
  }

  async function saveSettings() {
    if (!activeTournamentId) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${activeTournamentId}/query/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(settings),
      });
      if (res.ok) setSettings((await res.json()) as Settings);
    } finally {
      setBusy(false);
    }
  }

  if (tournaments.length === 0) return null;

  return (
    <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            {t('organizer.tournamentQuery.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{t('organizer.tournamentQuery.description')}</p>
        </div>
        <label className="text-sm font-medium text-gray-700" htmlFor="queryTournament">
          {t('organizer.tournamentQuery.tournament')}
          <select
            id="queryTournament"
            value={activeTournamentId}
            onChange={(event) => setSelectedTournamentId(event.target.value)}
            className="ml-2 rounded-lg border border-gray-300 px-3 py-2"
          >
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void askQuestion();
        }}
      >
        <label className="flex-1" htmlFor="tournamentQueryQuestion">
          <span className="sr-only">{t('organizer.tournamentQuery.question')}</span>
          <input
            id="tournamentQueryQuestion"
            aria-label={t('organizer.tournamentQuery.question')}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('organizer.tournamentQuery.placeholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !estimate?.allowed || question.trim().length < 4}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {busy ? t('organizer.tournamentQuery.asking') : t('organizer.tournamentQuery.ask')}
        </button>
      </form>

      <p className="mt-2 text-xs text-gray-500">
        {estimate
          ? t('organizer.tournamentQuery.estimate', {
              cost: estimate.estimatedCostEur.toFixed(3),
              spent: estimate.currentSpend.toFixed(2),
              cap: estimate.cap?.toFixed(2) ?? t('common.none'),
            })
          : t('organizer.tournamentQuery.estimatePending')}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setQuestion(suggestion)}
            className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-700 hover:border-red-300"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {response && (
        <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
          {response.kind === 'result' && response.result ? (
            <>
              {response.summary && <p className="mb-3 text-sm text-gray-800">{response.summary}</p>}
              <ResultView
                result={response.result}
                metricLabel={t('organizer.tournamentQuery.metric')}
              />
              <button
                type="button"
                onClick={() => setMetadataOpen(!metadataOpen)}
                className="mt-3 text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                {t('organizer.tournamentQuery.metadata')}
              </button>
              {metadataOpen && (
                <pre className="mt-2 overflow-auto rounded bg-white p-3 text-xs text-gray-700">
                  {JSON.stringify(response.result.metadata, null, 2)}
                </pre>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-700">{response.message}</p>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            {t('organizer.tournamentQuery.history')}
          </h3>
          <div className="mt-2 space-y-2">
            {history.length === 0 && (
              <p className="text-sm text-gray-500">{t('organizer.tournamentQuery.emptyHistory')}</p>
            )}
            {history.map((item) => (
              <button
                key={`${item.created_at}-${item.question}`}
                type="button"
                onClick={() => {
                  setQuestion(item.question);
                  void askQuestion(item.question);
                }}
                className="block w-full rounded border border-gray-200 bg-white p-2 text-left text-xs hover:border-red-300"
              >
                <span className="font-medium text-gray-800">{item.question}</span>
                {item.summary && <span className="mt-1 block text-gray-500">{item.summary}</span>}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            {t('organizer.tournamentQuery.settings')}
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
            <label className="text-xs text-gray-600" htmlFor="queryAccessPolicy">
              {t('organizer.tournamentQuery.accessPolicy')}
              <select
                id="queryAccessPolicy"
                value={settings.accessPolicy}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, accessPolicy: event.target.value }))
                }
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="organizers_only">
                  {t('organizer.tournamentQuery.access.organizersOnly')}
                </option>
                <option value="organizers_head_judges">
                  {t('organizer.tournamentQuery.access.headJudges')}
                </option>
                <option value="organizers_head_judges_coaches">
                  {t('organizer.tournamentQuery.access.coaches')}
                </option>
                <option value="anyone_with_tournament_access">
                  {t('organizer.tournamentQuery.access.anyone')}
                </option>
              </select>
            </label>
            <label className="text-xs text-gray-600" htmlFor="queryRateLimit">
              {t('organizer.tournamentQuery.rateLimit')}
              <input
                id="queryRateLimit"
                aria-label={t('organizer.tournamentQuery.rateLimit')}
                type="number"
                min="1"
                max="500"
                value={settings.rateLimitPerHour}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    rateLimitPerHour: Number(event.target.value),
                  }))
                }
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={busy}
              className="self-end rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {t('actions.save')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ResultView({ result, metricLabel }: { result: ToolResult; metricLabel: string }) {
  if (result.render_hint === 'empty') {
    return <p className="text-sm text-gray-600">{result.metadata.notes?.[0] ?? result.title}</p>;
  }
  if (result.render_hint === 'card' && result.card) {
    return (
      <div>
        <h3 className="font-semibold text-gray-900">{result.title}</h3>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {Object.entries(result.card).map(([label, value]) => (
            <div key={label} className="rounded bg-white p-2">
              <dt className="text-xs text-gray-500">{label}</dt>
              <dd className="text-sm font-semibold text-gray-900">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (result.render_hint === 'list' && result.items) {
    return (
      <div>
        <h3 className="font-semibold text-gray-900">{result.title}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {result.items.map((item) => (
            <li key={`${item.label}-${item.value}`}>
              <span className="font-medium">{item.label}</span> {item.value}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (result.render_hint === 'comparison' && result.comparison) {
    return (
      <div>
        <h3 className="font-semibold text-gray-900">{result.title}</h3>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left" scope="col">
                {metricLabel}
              </th>
              {result.comparison.entities.map((entity) => (
                <th key={entity} className="px-2 py-1 text-left" scope="col">
                  {entity}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.comparison.metrics).map(([metric, values]) => (
              <tr key={metric}>
                <th className="px-2 py-1 text-left" scope="row">
                  {metric}
                </th>
                {values.map((value, index) => (
                  <td key={`${metric}-${index}`} className="px-2 py-1">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (result.render_hint === 'summary_stats' && result.items) {
    return (
      <div>
        <h3 className="font-semibold text-gray-900">{result.title}</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {result.items.map((item) => (
            <div key={item.label} className="rounded bg-white p-3">
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="text-lg font-bold text-gray-900">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="font-semibold text-gray-900">{result.title}</h3>
      <div className="mt-2 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {(result.columns ?? []).map((column) => (
                <th key={column} className="px-2 py-1 text-left" scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(result.rows ?? []).map((row, index) => (
              <tr key={index} className="border-t border-gray-200">
                {(result.columns ?? []).map((column) => (
                  <td key={column} className="px-2 py-1">
                    {row[column]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
