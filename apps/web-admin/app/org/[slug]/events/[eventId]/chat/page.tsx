'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { ProposalCard, type ChatProposal } from './ProposalCard';

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

export default function EventChatPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<ConversationView | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/organizations/slug/${slug}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/chat/conversations`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([orgRes, convRes]) => {
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
        if (convRes.ok) {
          const list = (await convRes.json()) as ConversationSummary[];
          setConversations(list);
          if (list[0]) await openConversation(list[0].id, controller.signal);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, eventId, slug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages.length, busy]);

  async function openConversation(id: string, signal?: AbortSignal) {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/chat/conversations/${id}`, {
      credentials: 'include',
      signal,
    });
    if (res.ok) setActive((await res.json()) as ConversationView);
  }

  async function refreshConversations() {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/chat/conversations`, {
      credentials: 'include',
    });
    if (res.ok) setConversations((await res.json()) as ConversationSummary[]);
  }

  function startNewConversation() {
    setActive(null);
    setError(null);
  }

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      let conversationId = active?.id;
      if (!conversationId) {
        const createRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/chat/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        if (!createRes.ok) throw new Error(t('organizer.chat.errorSend'));
        conversationId = ((await createRes.json()) as ConversationView).id;
      }
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/chat/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ content }),
        },
      );
      if (!res.ok) throw new Error(t('organizer.chat.errorSend'));
      setActive((await res.json()) as ConversationView);
      setInput('');
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.chat.errorSend'));
    } finally {
      setBusy(false);
    }
  }

  async function resolveProposal(draftId: string, decision: 'confirm' | 'reject') {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/chat/conversations/${active.id}/proposals/${draftId}/${decision}`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(t('organizer.chat.errorSend'));
      const body = (await res.json()) as ConversationView | { conversation: ConversationView };
      setActive('conversation' in body ? body.conversation : body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.chat.errorSend'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="mb-6 text-sm text-muted">
        <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-foreground-secondary">
          {t('organizer.chat.backToEvent')}
        </Link>
      </div>

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
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void openConversation(c.id)}
                className={[
                  'w-full truncate rounded-lg border px-3 py-2 text-left text-sm',
                  active?.id === c.id
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border text-foreground-secondary hover:border-muted',
                ].join(' ')}
              >
                {c.title ?? new Date(c.updatedAt ?? '').toLocaleString()}
              </button>
            ))}
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
                  {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
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
            {busy && <p className="text-sm text-muted">{t('organizer.chat.thinking')}</p>}
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
    </main>
  );
}
