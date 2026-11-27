'use client';

import Link from 'next/link';
import { usePathname, useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { statusLabel } from '@myclash/ui';
import { apiRequest, failureMessage, type ApiResult } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useEventStatus } from '../_hooks/useEventStatus';
import { applyFailureMessage, rejectFailureMessage } from '@/lib/discard-refusal';
import { BackLink } from '@/components/BackLink';
import type { AssistantDraft, DraftType } from '@/components/ai/assistant-draft';
import { DraftPanel } from './DraftPanel';

interface Tournament {
  id: string;
  name: string;
}

/** What an Apply or a Reject says: shown only while the address still names its draft. */
interface DecisionWords {
  message?: string;
  error?: string | null;
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
  const router = useRouter();
  const pathname = usePathname();
  const { slug, eventId } = params;
  // Lower-cased, as the API answers ids: an upper-case link would never match the draft shown,
  // and every reread after Apply would be dropped.
  const openDraftId = search.get('draft')?.toLowerCase() ?? null;
  const draftsPath = `/api/v1/events/${eventId}/ai-assistant/drafts`;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The draft the address names, for a read that lands after the address moved on. */
  const addressedDraft = useRef<string | null>(null);

  const selectedNeedsTournament = draftType !== 'tournament_config';

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      apiRequest<{ id: string }>(apiUrl, `/api/v1/organizations/slug/${slug}`, {
        signal: controller.signal,
      }),
      apiRequest<Tournament[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`, {
        signal: controller.signal,
      }),
      apiRequest<AssistantDraft[]>(apiUrl, `/api/v1/events/${eventId}/ai-assistant/drafts`, {
        signal: controller.signal,
      }),
    ]).then(async ([orgRes, tournamentRes, draftsRes]) => {
      // `aiReady` gates the whole form, so a refused read still reads as NOT
      // ready — unchanged.
      if (orgRes.ok) {
        setOrgId(orgRes.data.id);
        const ai = await apiRequest<unknown>(
          apiUrl,
          `/api/v1/organizations/${orgRes.data.id}/ai-settings`,
          { signal: controller.signal },
        );
        setAiReady(ai.ok && ai.data !== null);
      } else {
        setAiReady(false);
      }
      if (tournamentRes.ok) setTournaments(tournamentRes.data);
      if (draftsRes.ok) setDrafts(draftsRes.data);
    });
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
    const r = await apiRequest<AssistantDraft[]>(
      apiUrl,
      `/api/v1/events/${eventId}/ai-assistant/drafts`,
    );
    if (r.ok) setDrafts(r.data);
  }

  /**
   * One draft, by its id (call V): the list holds only the newest 50, and a link from Claude may
   * name an older one. An id of no draft at this Event is a 404, a malformed one a 400; the API's
   * sentence names the id, so `showDraft` says the page's own words.
   */
  function readDraft(id: string, signal?: AbortSignal) {
    return apiRequest<AssistantDraft>(apiUrl, `${draftsPath}/${id}`, { signal });
  }

  function showDraft(r: ApiResult<AssistantDraft>) {
    if (r.ok) {
      setSelectedDraft(r.data);
      return;
    }
    if (r.kind === 'http' && (r.status === 404 || r.status === 400)) {
      setSelectedDraft(null);
      setError(t('organizer.aiAssistant.draftNotFound'));
      return;
    }
    const message = failureMessage(r, t, t('organizer.aiAssistant.openError'));
    if (message) setError(message);
  }

  // The address names the open draft, so a reload or a link opens it. A newer choice aborts
  // the read of the older one, which would otherwise land last and show the wrong draft.
  useEffect(() => {
    addressedDraft.current = openDraftId;
    if (!openDraftId) return;
    const controller = new AbortController();
    void readDraft(openDraftId, controller.signal).then(showDraft);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDraftId]);

  function selectDraft(draft: AssistantDraft) {
    // A word about the draft shown before (a bad link, an Apply) is not about this one.
    setError(null);
    setMessage(null);
    setSelectedDraft(draft);
    const next = new URLSearchParams(search.toString());
    next.set('draft', draft.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  async function createDraft() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await apiRequest<AssistantDraft>(
        apiUrl,
        `/api/v1/events/${eventId}/ai-assistant/drafts`,
        {
          method: 'POST',
          body: {
            draftType,
            prompt,
            tournamentId: selectedNeedsTournament ? tournamentId : undefined,
          },
        },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('organizer.aiAssistant.createError'));
        if (message) setError(message);
        return;
      }
      selectDraft(r.data);
      setMessage(t('organizer.aiAssistant.createSuccess'));
      await refreshDrafts();
    } finally {
      setBusy(false);
    }
  }

  async function applyDraft(id: string): Promise<DecisionWords> {
    const r = await apiRequest(apiUrl, `${draftsPath}/${id}/apply`, { method: 'POST' });
    if (r.ok) return { message: t('organizer.aiAssistant.applySuccess') };
    // Applying a draft writes real tournament configuration. When it is
    // refused, which action collided is the only thing worth saying.
    return { error: applyFailureMessage(r, t, t('organizer.aiAssistant.applyError')) };
  }

  async function rejectDraft(id: string): Promise<DecisionWords> {
    const r = await apiRequest(apiUrl, `${draftsPath}/${id}`, {
      method: 'PATCH',
      body: { status: 'rejected' },
    });
    if (r.ok) return { message: t('organizer.aiAssistant.rejectSuccess') };
    return { error: rejectFailureMessage(r, t, t('organizer.aiAssistant.rejectError')) };
  }

  /**
   * Apply or Reject, then the open draft reads again: applied, rejected, partly applied, or
   * closed by another tab, it shows its new state. The history's buttons wait while this runs,
   * but the address can still move (a link, the browser's Back): then the address's own read
   * shows its draft, and this one, landing later, is dropped with its words ("Draft applied."
   * would sit above another draft).
   */
  async function decide(decision: (id: string) => Promise<DecisionWords>) {
    if (!selectedDraft) return;
    const id = selectedDraft.id;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const words = await decision(id);
      const [read] = await Promise.all([readDraft(id), refreshDrafts()]);
      if (addressedDraft.current !== id) return;
      if (words.message) setMessage(words.message);
      if (words.error) setError(words.error);
      showDraft(read);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[110rem] p-8">
      <BackLink
        href={`/org/${slug}/events/${eventId}`}
        label={t('organizer.aiAssistant.backToEvent')}
        className="mb-6"
      />

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
              disabled={busy || aiReady === false || prompt.trim().length < 4 || isReadOnly}
              title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? t('organizer.aiAssistant.working') : t('organizer.aiAssistant.createDraft')}
            </button>
          </div>

          {message && (
            <p role="status" className="text-sm text-success">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {selectedDraft && (
            <DraftPanel
              draft={selectedDraft}
              busy={busy}
              isReadOnly={isReadOnly}
              onApply={() => void decide(applyDraft)}
              onReject={() => void decide(rejectDraft)}
              t={t}
            />
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
                disabled={busy}
                className="w-full rounded-lg border border-border p-3 text-left hover:border-accent disabled:opacity-50"
              >
                <span className="block text-sm font-semibold text-foreground">
                  {t(`organizer.aiAssistant.types.${draft.draftType}`)}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {statusLabel('aiDraft', draft.status, t)}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
