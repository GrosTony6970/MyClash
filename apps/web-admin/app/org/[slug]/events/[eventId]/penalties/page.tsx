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
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';

interface Person {
  id: string;
  givenName: string;
  familyName: string;
}

interface Registration {
  id: string;
  personId: string;
  tournamentId: string;
}

interface Tournament {
  id: string;
  name: string;
}

interface PenaltyReview {
  id: string;
  tournament_id: string;
  registration_id: string;
  review_type: string;
  status: 'pending' | 'confirmed' | 'dismissed';
  black_card_count: number | null;
  created_at: string;
  reviewed_at: string | null;
}

export default function PenaltyReviewsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [reviews, setReviews] = useState<PenaltyReview[]>([]);
  const [personByRegistration, setPersonByRegistration] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [tRes, rRes, pRes] = await Promise.all([
          fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
            credentials: 'include',
            signal: controller.signal,
          }),
          fetch(`${apiUrl}/api/v1/events/${eventId}/registrations`, {
            credentials: 'include',
            signal: controller.signal,
          }),
          fetch(`${apiUrl}/api/v1/events/${eventId}/persons`, {
            credentials: 'include',
            signal: controller.signal,
          }),
        ]);
        if (!tRes.ok) return;
        const tournamentRows = (await tRes.json()) as Tournament[];
        setTournaments(tournamentRows);

        // registration_id → fighter display name (never raw ids in the UI).
        if (rRes.ok && pRes.ok) {
          const registrations = (await rRes.json()) as Registration[];
          const persons = (await pRes.json()) as Person[];
          const nameByPerson = new Map(
            persons.map((p) => [p.id, `${p.givenName} ${p.familyName}`.trim()]),
          );
          setPersonByRegistration(
            new Map(registrations.map((r) => [r.id, nameByPerson.get(r.personId) ?? ''])),
          );
        }

        const reviewLists = await Promise.all(
          tournamentRows.map(async (tournament) => {
            const res = await fetch(
              `${apiUrl}/api/v1/tournaments/${tournament.id}/penalty-reviews`,
              { credentials: 'include', signal: controller.signal },
            );
            return res.ok ? ((await res.json()) as PenaltyReview[]) : [];
          }),
        );
        setReviews(reviewLists.flat());
      } catch {
        // AbortError or network — keep whatever state we have.
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [apiUrl, eventId, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  async function resolve(review: PenaltyReview, status: 'confirmed' | 'dismissed') {
    const name =
      personByRegistration.get(review.registration_id) ||
      t('organizer.penaltyReviews.unknownFighter');
    const tournamentName = tournaments.find((tour) => tour.id === review.tournament_id)?.name ?? '';
    if (status === 'confirmed') {
      const ok = await confirm({
        title: t('organizer.penaltyReviews.confirmDqPrompt', {
          name,
          tournament: tournamentName,
        }),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournament-penalty-reviews/${review.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? t('organizer.penaltyReviews.actionFailed'));
      }
      toast.success(
        status === 'confirmed'
          ? t('organizer.penaltyReviews.confirmedToast', { name })
          : t('organizer.penaltyReviews.dismissedToast'),
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('organizer.penaltyReviews.actionFailed'));
    }
  }

  const pending = reviews.filter((r) => r.status === 'pending');
  const resolved = reviews.filter((r) => r.status !== 'pending');
  const tournamentName = (id: string) => tournaments.find((tour) => tour.id === id)?.name ?? '—';
  const fighterName = (registrationId: string) =>
    personByRegistration.get(registrationId) || t('organizer.penaltyReviews.unknownFighter');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {t('organizer.penaltyReviews.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('organizer.penaltyReviews.subtitle')}</p>
      </header>

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
                        onClick={() => void resolve(review, 'confirmed')}
                        className="rounded-md bg-danger px-3 py-1.5 text-sm font-semibold text-danger-foreground hover:bg-danger-hover"
                      >
                        {t('organizer.penaltyReviews.confirmDq')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void resolve(review, 'dismissed')}
                        className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-foreground"
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
