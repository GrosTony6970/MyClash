'use client';

import Link from 'next/link';
import { Button } from '@myclash/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

type DraftType =
  | 'tournament_config'
  | 'pool_plan'
  | 'bracket_plan'
  | 'schedule_grid'
  | 'referee_assignments';

interface Tournament {
  id: string;
  name: string;
}

interface AssistantDraft {
  id: string;
  tournamentId: string | null;
  draftType: DraftType;
  prompt: string;
  summary: string | null;
  proposedActions: Array<Record<string, unknown>>;
  validationState: { ok?: boolean; warnings?: string[]; errors?: string[] };
  status: 'draft' | 'ready' | 'failed' | 'applied' | 'rejected';
  error: string | null;
  createdAt?: string;
}

const DRAFT_TYPES: DraftType[] = [
  'tournament_config',
  'pool_plan',
  'bracket_plan',
  'schedule_grid',
  'referee_assignments',
];

export default function EventAIAssistantPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const search = useSearchParams();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const initialType = DRAFT_TYPES.includes(search.get('type') as DraftType)
    ? (search.get('type') as DraftType)
    : 'tournament_config';

  const [orgId, setOrgId] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [drafts, setDrafts] = useState<AssistantDraft[]>([]);
  const [draftType, setDraftType] = useState<DraftType>(initialType);
  const [tournamentId, setTournamentId] = useState(search.get('tournamentId') ?? '');
  const [prompt, setPrompt] = useState('');
  const [selectedDraft, setSelectedDraft] = useState<AssistantDraft | null>(null);
  const [actionsJson, setActionsJson] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedNeedsTournament = draftType !== 'tournament_config';

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/organizations/slug/${slug}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/ai-assistant/drafts`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([orgRes, tournamentRes, draftsRes]) => {
        if (orgRes.ok) {
          const org = (await orgRes.json()) as { id: string };
          setOrgId(org.id);
          const aiRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/ai-settings`, {
            credentials: 'include',
            signal: controller.signal,
          });
          setAiReady(aiRes.ok && (await aiRes.json()) !== null);
        } else {
          setAiReady(false);
        }
        if (tournamentRes.ok) setTournaments((await tournamentRes.json()) as Tournament[]);
        if (draftsRes.ok) setDrafts((await draftsRes.json()) as AssistantDraft[]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, eventId, slug]);

  const draftTypeOptions = useMemo(
    () =>
      DRAFT_TYPES.map((type) => ({
        value: type,
        label: t(`organizer.aiAssistant.types.${type}`),
      })),
    [t],
  );

  async function refreshDrafts() {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-assistant/drafts`, {
      credentials: 'include',
    });
    if (res.ok) setDrafts((await res.json()) as AssistantDraft[]);
  }

  function selectDraft(draft: AssistantDraft) {
    setSelectedDraft(draft);
    setActionsJson(JSON.stringify(draft.proposedActions, null, 2));
  }

  async function createDraft() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-assistant/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          draftType,
          prompt,
          tournamentId: selectedNeedsTournament ? tournamentId : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.aiAssistant.createError'));
      }
      const draft = (await res.json()) as AssistantDraft;
      selectDraft(draft);
      setMessage(t('organizer.aiAssistant.createSuccess'));
      await refreshDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.aiAssistant.createError'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!selectedDraft) return;
    setBusy(true);
    setError(null);
    try {
      const actions = JSON.parse(actionsJson) as Array<Record<string, unknown>>;
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/ai-assistant/drafts/${selectedDraft.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ proposedActions: actions, status: 'ready' }),
        },
      );
      if (!res.ok) throw new Error(t('organizer.aiAssistant.saveError'));
      const updated = (await res.json()) as AssistantDraft;
      setSelectedDraft(updated);
      setMessage(t('organizer.aiAssistant.saveSuccess'));
      await refreshDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.aiAssistant.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function applyDraft() {
    if (!selectedDraft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/ai-assistant/drafts/${selectedDraft.id}/apply`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('organizer.aiAssistant.applyError'));
      }
      setMessage(t('organizer.aiAssistant.applySuccess'));
      await refreshDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.aiAssistant.applyError'));
    } finally {
      setBusy(false);
    }
  }

  async function rejectDraft() {
    if (!selectedDraft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/ai-assistant/drafts/${selectedDraft.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: 'rejected' }),
        },
      );
      if (!res.ok) throw new Error(t('organizer.aiAssistant.rejectError'));
      setMessage(t('organizer.aiAssistant.rejectSuccess'));
      setSelectedDraft(null);
      await refreshDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.aiAssistant.rejectError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-8">
      <div className="mb-6">
        <Button variant="back" size="sm" asChild>
          <Link href={`/org/${slug}/events/${eventId}`}>
            ← {t('organizer.aiAssistant.backToEvent')}
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('organizer.aiAssistant.title')}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          {t('organizer.aiAssistant.description')}
        </p>
      </div>

      {aiReady === false && (
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          {t('organizer.aiAssistant.missingKey')}{' '}
          {orgId && (
            <Link href={`/org/${slug}/settings/ai`} className="font-semibold underline">
              {t('organizer.aiAssistant.configureKey')}
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              className="text-sm font-medium text-foreground-secondary"
              htmlFor="ai-assistant-draft-type"
            >
              {t('organizer.aiAssistant.draftType')}
              <select
                id="ai-assistant-draft-type"
                value={draftType}
                onChange={(event) => setDraftType(event.target.value as DraftType)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
              >
                {draftTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label
              className="text-sm font-medium text-foreground-secondary"
              htmlFor="ai-assistant-tournament"
            >
              {t('organizer.aiAssistant.tournament')}
              <select
                id="ai-assistant-tournament"
                value={tournamentId}
                disabled={!selectedNeedsTournament}
                onChange={(event) => setTournamentId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 disabled:bg-background"
              >
                <option value="">{t('common.optional')}</option>
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label
            className="block text-sm font-medium text-foreground-secondary"
            htmlFor="ai-assistant-prompt"
          >
            {t('organizer.aiAssistant.prompt')}
            <textarea
              id="ai-assistant-prompt"
              aria-label={t('organizer.aiAssistant.prompt')}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2"
              placeholder={t('organizer.aiAssistant.promptPlaceholder')}
            />
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void createDraft()}
              disabled={busy || aiReady === false || prompt.trim().length < 4}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? t('organizer.aiAssistant.working') : t('organizer.aiAssistant.createDraft')}
            </button>
          </div>

          {message && <p className="text-sm text-success">{message}</p>}
          {error && <p className="text-sm text-danger">{error}</p>}

          {selectedDraft && (
            <div className="mt-6 space-y-4 border-t border-border pt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
                    {t('organizer.aiAssistant.preview')}
                  </h2>
                  <p className="text-sm text-foreground-secondary">{selectedDraft.summary}</p>
                </div>
                <span className="rounded-full bg-border px-3 py-1 text-xs font-semibold text-foreground-secondary">
                  {selectedDraft.status}
                </span>
              </div>

              {selectedDraft.validationState.errors?.length ? (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                  {selectedDraft.validationState.errors.join(', ')}
                </div>
              ) : null}

              {selectedDraft.validationState.warnings?.length ? (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  {selectedDraft.validationState.warnings.join(', ')}
                </div>
              ) : null}

              <label
                className="block text-sm font-medium text-foreground-secondary"
                htmlFor="ai-assistant-actions"
              >
                {t('organizer.aiAssistant.actions')}
                <textarea
                  id="ai-assistant-actions"
                  aria-label={t('organizer.aiAssistant.actions')}
                  value={actionsJson}
                  onChange={(event) => setActionsJson(event.target.value)}
                  rows={12}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 font-mono text-xs"
                />
              </label>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={busy}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
                >
                  {t('actions.save')}
                </button>
                <button
                  type="button"
                  onClick={() => void applyDraft()}
                  disabled={busy || selectedDraft.status !== 'ready'}
                  className="rounded-lg bg-strong px-4 py-2 text-sm font-semibold text-strong-foreground hover:bg-strong-hover disabled:opacity-50"
                >
                  {t('actions.apply')}
                </button>
                <button
                  type="button"
                  onClick={() => void rejectDraft()}
                  disabled={busy}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {t('actions.reject')}
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('organizer.aiAssistant.history')}
          </h2>
          <div className="mt-4 space-y-2">
            {drafts.length === 0 && (
              <p className="text-sm text-muted">{t('organizer.aiAssistant.emptyHistory')}</p>
            )}
            {drafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                onClick={() => selectDraft(draft)}
                className="w-full rounded-lg border border-border p-3 text-left hover:border-accent"
              >
                <span className="block text-sm font-semibold text-foreground">
                  {t(`organizer.aiAssistant.types.${draft.draftType}`)}
                </span>
                <span className="mt-1 block text-xs text-muted">{draft.status}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
