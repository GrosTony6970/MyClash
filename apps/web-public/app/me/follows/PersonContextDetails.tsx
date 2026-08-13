'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { PersonContext, PersonContextFinalRank, PersonContextMatch } from './personContext';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/** A short "in ~25 min" / "starts soon" label for a match within the next hour,
 *  against the (possibly simulated) clock. Returns null when the match is more
 *  than an hour out — the caller falls back to the absolute date/time. */
function formatRelative(
  iso: string | null,
  now: number | undefined,
  t: ReturnType<typeof useI18n>['t'],
): string | null {
  if (!iso || now === undefined) return null;
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return null;
  const diffMin = (start - now) / 60000;
  if (diffMin < 1) return t('publicApp.me.people.ctxStartsSoon');
  if (diffMin < 60)
    return t('publicApp.me.people.ctxInMinutes', { n: String(Math.round(diffMin)) });
  return null;
}

/** e.g. "🥇 #1" for the champion, "#5" otherwise. */
function finalRankLabel(fr: PersonContextFinalRank): string {
  const medal =
    fr.resultKind === 'champion'
      ? '🥇'
      : fr.resultKind === 'runnerUp'
        ? '🥈'
        : fr.resultKind === 'third'
          ? '🥉'
          : '';
  return `${medal} #${fr.place}`.trim();
}

function MaybeLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </Link>
  );
}

/** The highlighted in-progress line — a live bout the fighter is in, or a match
 *  they're currently refereeing. */
function LiveLine({ match }: { match: PersonContextMatch }) {
  const { t } = useI18n();
  const href =
    match.eventSlug && match.matchId ? `/e/${match.eventSlug}/match/${match.matchId}` : null;

  const detail =
    match.kind === 'referee'
      ? [t('publicApp.me.people.ctxRefereeing'), match.skillName, match.label, match.liceName]
          .filter(Boolean)
          .join(' · ')
      : [
          match.label,
          match.opponentName ? t('publicApp.me.people.ctxVs', { name: match.opponentName }) : null,
          match.liceName,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <MaybeLink href={href}>
      <p className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded bg-danger/15 px-1.5 py-0.5 font-bold uppercase tracking-wide text-danger">
          <span
            className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse motion-reduce:animate-none"
            aria-hidden
          />
          {t('publicApp.me.people.ctxLive')}
        </span>
        {match.kind === 'referee' && match.skillColor && (
          <span
            aria-hidden
            style={{ backgroundColor: match.skillColor }}
            className="inline-block h-2 w-2 rounded-full"
          />
        )}
        <span className="font-medium text-foreground">{detail}</span>
      </p>
    </MaybeLink>
  );
}

/**
 * The live tournament-context block on a People-hub fighter card: event,
 * tournament, pool, pool + final rank, a live line (current bout / refereeing),
 * and the next match. Shared by the Search and Following tabs. `now` (the
 * simulation-aware clock) enables relative match times; when omitted the next
 * match shows its absolute time.
 */
export function PersonContextDetails({
  ctx,
  now,
  hideEvent = false,
  loading = false,
}: {
  ctx?: PersonContext;
  now?: number;
  /** Suppress the event eyebrow when the card sits under an event group header. */
  hideEvent?: boolean;
  loading?: boolean;
}) {
  const { t } = useI18n();

  if (!ctx) {
    if (loading) {
      return (
        <div className="mt-3 border-t border-border pt-3">
          <div className="h-3 w-40 animate-pulse rounded bg-foreground/10" />
        </div>
      );
    }
    return null;
  }

  const eyebrow =
    ctx.event?.name ?? (ctx.currentMatch?.kind === 'referee' ? ctx.currentMatch.eventName : null);

  const nextWhen = ctx.nextMatch
    ? (formatRelative(ctx.nextMatch.scheduledAt, now, t) ?? formatWhen(ctx.nextMatch.scheduledAt))
    : null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      {eyebrow && !hideEvent && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
      )}

      {ctx.tournament && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {ctx.tournament.weapon && (
            <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[11px] font-medium text-muted">
              {ctx.tournament.weapon}
            </span>
          )}
          <Field label={t('publicApp.me.people.ctxTournament')} value={ctx.tournament.name} />
          {ctx.poolName && <Field label={t('publicApp.me.people.ctxPool')} value={ctx.poolName} />}
          {ctx.rank !== null && (
            <Field label={t('publicApp.me.people.ctxRank')} value={`#${ctx.rank}`} />
          )}
          {ctx.finalRank && (
            <Field
              label={t('publicApp.me.people.ctxFinalRank')}
              value={finalRankLabel(ctx.finalRank)}
            />
          )}
        </div>
      )}

      {ctx.currentMatch && <LiveLine match={ctx.currentMatch} />}

      {ctx.nextMatch ? (
        <MaybeLink
          href={
            ctx.nextMatch.eventSlug && ctx.nextMatch.matchId
              ? `/e/${ctx.nextMatch.eventSlug}/match/${ctx.nextMatch.matchId}`
              : null
          }
        >
          <p className="text-xs text-accent">
            <span className="font-semibold">{t('publicApp.me.people.ctxNextMatch')}:</span>{' '}
            {[
              ctx.nextMatch.label,
              ctx.nextMatch.opponentName
                ? t('publicApp.me.people.ctxVs', { name: ctx.nextMatch.opponentName })
                : null,
              nextWhen,
              ctx.nextMatch.liceName,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </MaybeLink>
      ) : (
        ctx.tournament &&
        !ctx.currentMatch && (
          <p className="text-xs text-muted">{t('publicApp.me.people.ctxNoMatch')}</p>
        )
      )}

      {!ctx.tournament &&
        !ctx.currentMatch &&
        (ctx.lastResult ? (
          <MaybeLink href={`/e/${ctx.lastResult.eventSlug}/t/${ctx.lastResult.tournamentSlug}`}>
            <p className="text-xs text-muted">
              <span className="font-semibold">{t('publicApp.me.people.ctxLastResult')}:</span>{' '}
              {[
                ctx.lastResult.finalRank ? finalRankLabel(ctx.lastResult.finalRank) : null,
                ctx.lastResult.tournamentName,
                ctx.lastResult.weapon,
                ctx.lastResult.eventName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </MaybeLink>
        ) : (
          <span className="text-xs text-muted">{t('publicApp.me.people.notCompeting')}</span>
        ))}
    </div>
  );
}
