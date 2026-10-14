'use client';

/**
 * Penalty reviews — the second-black-card disqualification queue.
 *
 * A fighter's second non-voided black card in a tournament auto-creates a
 * pending `tournament_penalty_reviews` row (penalties.service.ts
 * createSecondBlackCardReviewIfNeeded). Confirming disqualifies the
 * registration; dismissing closes the review. Before this page the state
 * machine was WRITE-ONLY: no UI listed or resolved the reviews, so the
 * disqualification rule never actually enforced.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useConfirm, useToast } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { PageAlert, errorOutcome } from '@/components/PageAlert';
import { localeToBcp47 } from '@myclash/time';
import { readPenaltyReviews, type PenaltyReview, type Tournament } from './penalty-reviews-read';
import { reviewedAt } from './reviewed-at';
import { useEventStatus } from '../_hooks/useEventStatus';

export default function PenaltyReviewsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  // An archived Event refuses these writes (ruling 377); its zone dates a resolved review.
  const { event, isReadOnly } = useEventStatus(eventId);
  // One answer at a time (O11): both buttons are off while one is being saved.
  const [writing, setWriting] = useState(false);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [reviews, setReviews] = useState<PenaltyReview[]>([]);
  const [personByRegistration, setPersonByRegistration] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Every read that failed, by name: an empty list must never stand for a list that
  // could not be read (O10). Each read replaces them, so a read that lands clears them.
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void readPenaltyReviews(apiUrl, eventId, t, controller.signal).then((read) => {
      if (!read) return;
      setTournaments(read.tournaments);
      setPersonByRegistration(read.personByRegistration);
      setReviews(read.reviews);
      setProblems(read.problems);
      setLoading(false);
    });
    return () => controller.abort();
  }, [apiUrl, eventId, refreshKey, t]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  async function resolve(review: PenaltyReview, status: 'confirmed' | 'dismissed') {
    const name =
      personByRegistration.get(review.registration_id) ||
      t('organizer.penaltyReviews.unknownFighter');
    const tournamentName = tournaments.find((tour) => tour.id === review.tournament_id)?.name ?? '';
    // Both answers ask first (O11): a mis-tap must not close a disqualification case.
    const ok = await confirm(
      status === 'confirmed'
        ? {
            title: t('organizer.penaltyReviews.confirmDqPrompt', {
              name,
              tournament: tournamentName,
            }),
            danger: true,
          }
        : {
            title: t('organizer.penaltyReviews.dismissPrompt', {
              name,
              tournament: tournamentName,
            }),
            confirmLabel: t('organizer.penaltyReviews.dismiss'),
            cancelLabel: t('common.cancel'),
          },
    );
    if (!ok) return;
    setWriting(true);
    const r = await apiRequest(apiUrl, `/api/v1/tournament-penalty-reviews/${review.id}`, {
      method: 'PATCH',
      body: { status },
    });
    setWriting(false);
    if (!r.ok) {
      const message = failureMessage(r, t, t('organizer.penaltyReviews.actionFailed'));
      if (message) toast.error(message);
      return;
    }
    toast.success(
      status === 'confirmed'
        ? t('organizer.penaltyReviews.confirmedToast', { name })
        : t('organizer.penaltyReviews.dismissedToast'),
    );
    refresh();
  }

  const pending = reviews.filter((r) => r.status === 'pending');
  const resolved = reviews.filter((r) => r.status !== 'pending');
  const tournamentName = (id: string) => tournaments.find((tour) => tour.id === id)?.name ?? '—';
  const fighterName = (registrationId: string) =>
    personByRegistration.get(registrationId) || t('organizer.penaltyReviews.unknownFighter');
  const answerClosed = writing || isReadOnly;
  const answeredAt = (review: PenaltyReview) =>
    reviewedAt(review.reviewed_at, event?.timezone, localeToBcp47(locale));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {t('organizer.penaltyReviews.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('organizer.penaltyReviews.subtitle')}</p>
      </header>

      {problems.map((problem, index) => (
        // By place: two Tournaments of one name can both fail.
        <PageAlert key={index} outcome={errorOutcome(problem)} />
      ))}

      {loading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {t('organizer.penaltyReviews.pendingTitle', { count: pending.length })}
            </h2>
            {pending.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                {t('organizer.penaltyReviews.emptyPending')}
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {pending.map((review) => (
                  <li
                    key={review.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-foreground">
                        {fighterName(review.registration_id)}
                      </p>
                      <p className="text-xs text-muted">
                        {tournamentName(review.tournament_id)} ·{' '}
                        {t('organizer.penaltyReviews.blackCards', {
                          count: review.black_card_count ?? 2,
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={answerClosed}
                        onClick={() => void resolve(review, 'confirmed')}
                        className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-danger-foreground hover:bg-danger-hover disabled:opacity-50"
                      >
                        {t('organizer.penaltyReviews.confirmDq')}
                      </button>
                      <button
                        type="button"
                        disabled={answerClosed}
                        onClick={() => void resolve(review, 'dismissed')}
                        className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground disabled:opacity-50"
                      >
                        {t('organizer.penaltyReviews.dismiss')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {resolved.length > 0 && (
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="font-display text-lg font-semibold text-foreground">
                {t('organizer.penaltyReviews.resolvedTitle', { count: resolved.length })}
              </h2>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {resolved.map((review) => (
                  <li key={review.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {fighterName(review.registration_id)}
                    </span>
                    <span className="text-muted">{tournamentName(review.tournament_id)}</span>
                    <span
                      className={
                        review.status === 'confirmed' ? 'text-danger font-semibold' : 'text-muted'
                      }
                    >
                      {review.status === 'confirmed'
                        ? t('organizer.penaltyReviews.statusConfirmed')
                        : t('organizer.penaltyReviews.statusDismissed')}
                    </span>
                    {review.reviewed_at && <span className="text-muted">{answeredAt(review)}</span>}
                    {review.status === 'dismissed' && (
                      <button
                        type="button"
                        disabled={answerClosed}
                        onClick={() => void resolve(review, 'confirmed')}
                        className="ml-auto rounded-md border border-danger/40 px-2 py-1 text-xs font-semibold text-danger disabled:opacity-50"
                      >
                        {t('organizer.penaltyReviews.disqualifyAfterAll')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {confirmDialog}
    </div>
  );
}
