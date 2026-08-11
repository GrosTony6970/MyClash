'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '../../../../src/i18n/I18nProvider';

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * How did the event go, from anyone who was there.
 *
 * Lives on `/e/[eventSlug]` rather than under `/me` for the same reason the
 * pass does: `/me` needs a claimed account, and at a real HEMA event most
 * participants are guests. The API resolves either identity through
 * ParticipantIdentityService, so fighters, referees, instructors and
 * workshop-only attendees all reach the same form.
 *
 * The respondent's ROLE is never sent from here — the server derives it from
 * the roster, so nobody can file as a referee to weight their opinion.
 */
/** Resolve the slug in the URL to the id the feedback endpoint takes. */
function useEventId(eventSlug: string): string | null {
  const [eventId, setEventId] = useState<string | null>(null);

  const loadEvent = useCallback(
    async (signal: AbortSignal) => {
      try {
        const res = await fetch(
          `${getPublicApiUrl()}/api/v1/events/${encodeURIComponent(eventSlug)}`,
          { credentials: 'include', signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { id?: string };
        if (body.id) setEventId(body.id);
      } catch {
        // Leave it null — the form stays disabled rather than posting nowhere.
      }
    },
    [eventSlug],
  );

  // Deferred off the effect body: a synchronous setState in one cascades
  // renders and the repo lints it at max-warnings 0.
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadEvent(controller.signal));
    return () => {
      controller.abort();
    };
  }, [loadEvent]);

  return eventId;
}

function RatingPicker({
  rating,
  onPick,
}: {
  rating: number | null;
  onPick: (value: number) => void;
}) {
  return (
    <div className="mt-2 flex gap-2">
      {RATINGS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onPick(value)}
          aria-pressed={rating === value}
          className={`h-11 w-11 rounded-lg border text-sm font-semibold transition-colors ${
            rating === value
              ? 'border-accent bg-accent text-accent-foreground'
              : 'border-border text-foreground'
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

/**
 * The free-text answer and the one decision attached to it.
 *
 * The tickbox label states the CONSEQUENCE rather than naming a setting:
 * someone deciding whether to be candid needs to know who will see their name.
 * Unticked by default — silence means anonymous, because the person who does
 * not read it is exactly the one anonymity is protecting.
 */
function CommentAndAttribution({
  comment,
  onComment,
  isAttributed,
  onAttributed,
  t,
}: {
  comment: string;
  onComment: (value: string) => void;
  isAttributed: boolean;
  onAttributed: (value: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <label className="mt-6 block text-sm font-semibold" htmlFor="feedback-comment">
        {t('publicApp.eventFeedback.commentLabel')}
      </label>
      <textarea
        id="feedback-comment"
        value={comment}
        onChange={(e) => onComment(e.target.value)}
        maxLength={2000}
        rows={5}
        className="mt-2 w-full rounded-lg border border-border bg-surface p-3 text-sm"
      />
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={isAttributed}
          onChange={(e) => onAttributed(e.target.checked)}
          className="mt-1"
        />
        <span>{t('publicApp.eventFeedback.attributeLabel')}</span>
      </label>
      <p className="mt-1 text-xs text-muted">
        {isAttributed
          ? t('publicApp.eventFeedback.attributedHint')
          : t('publicApp.eventFeedback.anonymousHint')}
      </p>
    </>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-foreground-secondary">{subtitle}</p>
    </>
  );
}

interface Answer {
  rating: number | null;
  comment: string;
  isAttributed: boolean;
}

function useSubmitFeedback(eventId: string | null, failedLabel: string) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (answer: Answer): Promise<void> => {
      if (!eventId || answer.rating === null) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`${getPublicApiUrl()}/api/v1/events/${eventId}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            rating: answer.rating,
            comment: answer.comment.trim() || null,
            isAttributed: answer.isAttributed,
          }),
        });
        if (!res.ok) throw new Error(failedLabel);
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : failedLabel);
      } finally {
        setSaving(false);
      }
    },
    [eventId, failedLabel],
  );

  return { submit, saving, done, error };
}

function Thanks({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-foreground-secondary">{body}</p>
    </main>
  );
}

export default function EventFeedbackPage() {
  const { t } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const eventId = useEventId(params.eventSlug);

  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [isAttributed, setIsAttributed] = useState(false);
  const { submit, saving, done, error } = useSubmitFeedback(
    eventId,
    t('publicApp.eventFeedback.failed'),
  );

  if (done) {
    return (
      <Thanks
        title={t('publicApp.eventFeedback.thanksTitle')}
        body={t('publicApp.eventFeedback.thanksBody')}
      />
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <Heading
        title={t('publicApp.eventFeedback.title')}
        subtitle={t('publicApp.eventFeedback.subtitle')}
      />

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold">
          {t('publicApp.eventFeedback.ratingLabel')}
        </legend>
        <RatingPicker rating={rating} onPick={setRating} />
      </fieldset>

      <CommentAndAttribution
        comment={comment}
        onComment={setComment}
        isAttributed={isAttributed}
        onAttributed={setIsAttributed}
        t={t}
      />

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => void submit({ rating, comment, isAttributed })}
        disabled={saving || rating === null || !eventId}
        className="mt-6 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {saving ? t('publicApp.eventFeedback.sending') : t('publicApp.eventFeedback.submit')}
      </button>
    </main>
  );
}
