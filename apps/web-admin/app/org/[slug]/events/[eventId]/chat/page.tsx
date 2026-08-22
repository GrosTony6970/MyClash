'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useConfirm } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { MessageMarkdown } from './MessageMarkdown';
import { ProposalCard, type ChatProposal } from './ProposalCard';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: Array<{ name: string }>;
  proposal: ChatProposal | null;
  createdAt?: string;
}

interface ConversationView {
  id: string;
  eventId: string;
  tournamentId: string | null;
  title: string | null;
  messages: ChatMessage[];
}

interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt?: string;
}

type StreamEvent =
  | { type: 'status'; phase: string }
  | { type: 'tool'; name: string }
  | { type: 'proposal'; draftId: string }
  | { type: 'assistant'; content: string }
  | { type: 'notice'; content: string }
  | { type: 'done'; conversation: ConversationView }
  | { type: 'error'; message?: string };

export default function EventChatPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const { confirm, confirmDialog } = useConfirm();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<ConversationView | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activity, setActivity] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      apiRequest<{ id: string }>(apiUrl, `/api/v1/organizations/slug/${slug}`, {
        signal: controller.signal,
      }),
      apiRequest<ConversationSummary[]>(apiUrl, `/api/v1/events/${eventId}/chat/conversations`, {
        signal: controller.signal,
      }),
    ]).then(async ([orgRes, convRes]) => {
      // `aiReady` decides whether the composer is enabled at all, so a refused
      // read has to read as NOT ready — that half is unchanged.
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
      if (convRes.ok) {
        setConversations(convRes.data);
        if (convRes.data[0]) await openConversation(convRes.data[0].id, controller.signal);
      }
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, eventId, slug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages.length, busy]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  async function openConversation(id: string, signal?: AbortSignal) {
    const r = await apiRequest<ConversationView>(
      apiUrl,
      `/api/v1/events/${eventId}/chat/conversations/${id}`,
      { signal },
    );
    if (r.ok) setActive(r.data);
  }

  async function refreshConversations() {
    const r = await apiRequest<ConversationSummary[]>(
      apiUrl,
      `/api/v1/events/${eventId}/chat/conversations`,
    );
    if (r.ok) setConversations(r.data);
  }

  function startNewConversation() {
    setActive(null);
    setError(null);
  }

  function activityLine(evt: StreamEvent): string | null {
    if (evt.type === 'tool') return t('organizer.chat.ranTool', { name: evt.name });
    if (evt.type === 'proposal') return t('organizer.chat.preparingProposal');
    if (evt.type === 'notice') return evt.content;
    return null; // status/assistant: no separate activity line
  }

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setActivity([]);
    try {
      let conversationId = active?.id;
      if (!conversationId) {
        const created = await apiRequest<ConversationView>(
          apiUrl,
          `/api/v1/events/${eventId}/chat/conversations`,
          { method: 'POST', body: {} },
        );
        if (!created.ok) {
          // Reported and returned rather than thrown: `?? ''` for the abort
          // null would be a branch that cannot fire on a request with no
          // signal, and the `finally` below still clears the busy flag.
          const message = failureMessage(created, t, t('organizer.chat.errorSend'));
          if (message) setError(message);
          return;
        }
        conversationId = created.data.id;
      }
      setInput('');

      // The ONE hand-rolled fetch left on this surface, and it has to be. This
      // is a streaming SSE POST read through `res.body.getReader()`; the seam
      // reads a whole body with `parseBody` and hands back a value, so routing
      // this through it would consume the stream before the first token could
      // be rendered. It keeps its own `credentials` and its own abort handling.
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/chat/conversations/${conversationId}/messages/stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content }),
        },
      );
      if (!res.ok || !res.body) throw new Error(t('organizer.chat.errorSend'));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue; // ignore ": ping" heartbeat comments
          let evt: StreamEvent;
          try {
            evt = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
          } catch {
            continue;
          }
          if (evt.type === 'done') {
            setActive(evt.conversation);
            finished = true;
          } else if (evt.type === 'error') {
            setError(evt.message ?? t('organizer.chat.errorSend'));
          } else {
            const line = activityLine(evt);
            if (line) setActivity((prev) => [...prev, line]);
          }
        }
      }
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.chat.errorSend'));
    } finally {
      setActivity([]);
      setBusy(false);
    }
  }

  async function resolveProposal(draftId: string, decision: 'confirm' | 'reject') {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest<ConversationView | { conversation: ConversationView }>(
        apiUrl,
        `/api/v1/events/${eventId}/chat/conversations/${active.id}/proposals/${draftId}/${decision}`,
        { method: 'POST' },
      );
      if (!r.ok) {
        // A refused proposal names what it collided with — a match already
        // scored, a lice already booked. That sentence used to be replaced by
        // "Could not send the message."
        const message = failureMessage(r, t, t('organizer.chat.errorSend'));
        if (message) setError(message);
        return;
      }
      setActive('conversation' in r.data ? r.data.conversation : r.data);
    } finally {
      setBusy(false);
    }
  }

  async function submitRename(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    const r = await apiRequest<ConversationView>(
      apiUrl,
      `/api/v1/events/${eventId}/chat/conversations/${id}`,
      { method: 'PATCH', body: { title } },
    );
    if (!r.ok) {
      // A refused rename used to snap the title back with no word at all.
      const message = failureMessage(r, t, t('organizer.chat.errorSend'));
      if (message) setError(message);
      return;
    }
    if (active?.id === id) setActive(r.data);
    await refreshConversations();
  }

  async function removeConversation(id: string) {
    if (!(await confirm({ title: t('organizer.chat.deleteConfirm'), danger: true }))) return;
    const r = await apiRequest(apiUrl, `/api/v1/events/${eventId}/chat/conversations/${id}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const message = failureMessage(r, t, t('organizer.chat.errorSend'));
      if (message) setError(message);
      return;
    }
    if (active?.id === id) setActive(null);
    await refreshConversations();
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <BackLink
        href={`/org/${slug}/events/${eventId}`}
        label={t('organizer.chat.backToEvent')}
        className="mb-6"
      />

      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
          {t('organizer.chat.title')}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{t('organizer.chat.description')}</p>
      </div>

      {aiReady === false && (
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          {t('organizer.chat.missingKey')}{' '}
          {orgId && (
            <Link href={`/org/${slug}/settings/ai`} className="font-semibold underline">
              {t('organizer.chat.configureKey')}
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-surface p-4">
          <button
            type="button"
            onClick={startNewConversation}
            className="mb-3 w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
          >
            {t('organizer.chat.newConversation')}
          </button>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('organizer.chat.conversations')}
          </p>
          <div className="space-y-1">
            {conversations.length === 0 && (
              <p className="text-sm text-muted">{t('organizer.chat.emptyHistory')}</p>
            )}
            {conversations.map((c) =>
              renamingId === c.id ? (
                <input
                  key={c.id}
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename(c.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => void submitRename(c.id)}
                  aria-label={t('organizer.chat.renameConversation')}
                  className="w-full rounded-lg border border-accent bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              ) : (
                <div key={c.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void openConversation(c.id)}
                    className={[
                      'min-w-0 flex-1 truncate rounded-lg border px-3 py-2 text-left text-sm',
                      active?.id === c.id
                        ? 'border-accent bg-accent/10 text-foreground'
                        : 'border-border text-foreground-secondary hover:border-muted',
                    ].join(' ')}
                  >
                    {c.title ?? new Date(c.updatedAt ?? '').toLocaleString(locale)}
                  </button>
                  <button
                    type="button"
                    aria-label={t('organizer.chat.renameConversation')}
                    title={t('organizer.chat.rename')}
                    onClick={() => {
                      setRenamingId(c.id);
                      setRenameValue(c.title ?? '');
                    }}
                    className="shrink-0 rounded-md p-1.5 text-muted hover:bg-background hover:text-foreground-secondary"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    aria-label={t('organizer.chat.deleteConversation')}
                    title={t('organizer.chat.delete')}
                    onClick={() => void removeConversation(c.id)}
                    className="shrink-0 rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ),
            )}
          </div>
        </aside>

        <section className="flex min-h-[60vh] flex-col rounded-lg border border-border bg-surface">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
            {(!active || active.messages.length === 0) && (
              <p className="text-sm text-muted">{t('organizer.chat.emptyConversation')}</p>
            )}
            {active?.messages.map((m) => (
              <div
                key={m.id}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={[
                    'max-w-[85%] rounded-2xl px-4 py-2 text-sm',
                    m.role === 'user'
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-background text-foreground',
                  ].join(' ')}
                >
                  <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide opacity-70">
                    {m.role === 'user' ? t('organizer.chat.you') : t('organizer.chat.assistant')}
                  </span>
                  {m.content &&
                    (m.role === 'assistant' ? (
                      <MessageMarkdown text={m.content} />
                    ) : (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ))}
                  {m.proposal && (
                    <ProposalCard
                      proposal={m.proposal}
                      busy={busy}
                      onConfirm={() => void resolveProposal(m.proposal!.id, 'confirm')}
                      onReject={() => void resolveProposal(m.proposal!.id, 'reject')}
                      t={t}
                    />
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="space-y-1">
                {(activity.length > 0 ? activity : [t('organizer.chat.thinking')]).map(
                  (line, i) => (
                    <p key={i} className="flex items-center gap-2 text-sm text-muted">
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                      {line}
                    </p>
                  ),
                )}
              </div>
            )}
          </div>

          {error && <p className="px-5 pb-2 text-sm text-danger">{error}</p>}

          <div className="flex items-end gap-2 border-t border-border p-3">
            <textarea
              aria-label={t('organizer.chat.placeholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              disabled={aiReady === false}
              placeholder={t('organizer.chat.placeholder')}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || aiReady === false || input.trim().length === 0}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              {t('organizer.chat.send')}
            </button>
          </div>
        </section>
      </div>
      {confirmDialog}
    </main>
  );
}
