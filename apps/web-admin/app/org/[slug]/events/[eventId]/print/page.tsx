'use client';

/**
 * Print pack — Route: /org/[slug]/events/[eventId]/print
 *
 * The event-day paper fallback. `O-209` in `docs/OWNER_TASKS.md` calls printed
 * scoresheets critical: "If MyClash dies catastrophically mid-event, you can
 * fall back to paper and import results after." Before this route the repo
 * printed only results — the final ranking and the referee compensation report
 * — and nothing an event is actually run on.
 *
 * One route rather than a print button on each of pools / bracket / schedule:
 * one print stylesheet, one place to look at 8 a.m. when a sheet comes out
 * wrong, and one document so the operator prints once and picks the whole pack
 * out of the tray in order.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { EventCrumb, OrgCrumb } from '@/components/Crumbs';
import { DEFAULT_EVENT_TIMEZONE, localeToBcp47 } from '@myclash/time';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { openPrintWindow } from '@/lib/print-window';
import { ALL_TOURNAMENTS } from '@/lib/tournament-choice';
import { useTournamentChoice } from '@/hooks/useTournamentChoice';
import { useI18n } from '@myclash/next-i18n/client';
import { packInput } from './pack-input';
import { printJoinedPacksHtml, printPackHtml, type PrintSectionKey } from './print-pack';
import type { PrintLabels } from './print-types';
import { usePrintPackData } from './usePrintPackData';

interface Tournament {
  id: string;
  name: string;
}

/**
 * Section labels are resolved with LITERAL `t()` keys, not
 * ``t(`organizer.printPack.${key}`)``. The i18n reverse sweep scans for static
 * references and would report every one of these as an orphaned key, and the
 * fix for that — whitelisting a dynamic prefix — turns off the check that
 * catches a genuinely dead key later.
 */
function sectionList(t: (key: string) => string) {
  return [
    {
      key: 'pools' as const,
      label: t('organizer.printPack.sectionPools'),
      hint: t('organizer.printPack.sectionPoolsHint'),
    },
    {
      key: 'bracket' as const,
      label: t('organizer.printPack.sectionBracket'),
      hint: t('organizer.printPack.sectionBracketHint'),
    },
    {
      key: 'pistes' as const,
      label: t('organizer.printPack.sectionPistes'),
      hint: t('organizer.printPack.sectionPistesHint'),
    },
    {
      key: 'scoresheets' as const,
      label: t('organizer.printPack.sectionScoresheets'),
      hint: t('organizer.printPack.sectionScoresheetsHint'),
    },
  ];
}

const apiUrl = getPublicApiUrl();

/**
 * Every string that lands on the paper, resolved once. Module-level and pure
 * so the page function stays about fetching and rendering, and so the builders
 * keep their guarantee that no English literal lives inside them.
 */
function sheetLabels(t: (key: string) => string): PrintLabels {
  return {
    poolSheet: t('organizer.printPack.sheet.poolSheet'),
    scoresheet: t('organizer.printPack.sheet.scoresheet'),
    pisteSheet: t('organizer.printPack.sheet.pisteSheet'),
    bracketSheet: t('organizer.printPack.sheet.bracketSheet'),
    fighter: t('organizer.printPack.sheet.fighter'),
    club: t('organizer.printPack.sheet.club'),
    bout: t('organizer.printPack.sheet.bout'),
    piste: t('organizer.printPack.sheet.piste'),
    referee: t('organizer.printPack.sheet.referee'),
    unassigned: t('organizer.printPack.sheet.unassigned'),
    score: t('organizer.printPack.sheet.score'),
    exchanges: t('organizer.printPack.sheet.exchanges'),
    doubles: t('organizer.printPack.sheet.doubles'),
    penalties: t('organizer.printPack.sheet.penalties'),
    winner: t('organizer.printPack.sheet.winner'),
    signature: t('organizer.printPack.sheet.signature'),
    round: t('organizer.printPack.sheet.round'),
    time: t('organizer.printPack.sheet.time'),
    generatedAt: t('organizer.printPack.sheet.generatedAt'),
    red: t('organizer.printPack.sheet.red'),
    blue: t('organizer.printPack.sheet.blue'),
    notes: t('organizer.printPack.sheet.notes'),
    unknownReferee: t('common.unknownName.referee'),
  };
}

export default function PrintPackPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const { t, locale } = useI18n();

  const [eventName, setEventName] = useState('');
  /**
   * The EVENT's zone, not this machine's. Every clock the pack prints belongs
   * to the hall, and an organiser preparing the pack the night before from
   * somewhere else is the ordinary case.
   */
  const [eventTz, setEventTz] = useState<string>(DEFAULT_EVENT_TIMEZONE);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const ids = tournaments.map((tournament) => tournament.id);
  // "All Tournaments" (O22) is a choice of this page alone: in its address, never remembered.
  const [selected, setSelected] = useTournamentChoice(
    eventId,
    ids.length > 1 ? [...ids, ALL_TOURNAMENTS] : ids,
  );
  const packs = usePrintPackData(
    selected === ALL_TOURNAMENTS ? ids : selected ? [selected] : [],
    t,
  );
  const [lices, setLices] = useState<Map<string, string>>(new Map());
  const [sections, setSections] = useState<PrintSectionKey[]>(['pools', 'bracket', 'pistes']);
  const [eventLoaded, setEventLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Event + tournament list ───────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    void Promise.all([
      apiRequest<{ name?: string; timezone?: string }>(
        apiUrl,
        `/api/v1/events/${eventId}`,
        options,
      ),
      apiRequest<Tournament[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`, options),
      apiRequest<Array<{ id: string; name: string }>>(
        apiUrl,
        `/api/v1/events/${eventId}/lices`,
        options,
      ),
    ])
      .then(([event, tournamentRows, liceRows]) => {
        // All three used to be read with a bare `.json()`, so a refusal came
        // back as a problem+json BODY cast to the expected shape — the print
        // pack drew a sheet titled `undefined` rather than saying anything.
        const failed = [event, tournamentRows, liceRows].find((r) => !r.ok);
        if (failed && !failed.ok) {
          const message = failureMessage(failed, t, t('organizer.printPack.loadError'));
          if (message) setError(message);
          return;
        }
        if (!event.ok || !tournamentRows.ok || !liceRows.ok) return;
        setEventName(event.data.name ?? '');
        setEventTz(event.data.timezone || DEFAULT_EVENT_TIMEZONE);
        setTournaments(tournamentRows.data ?? []);
        setLices(new Map(liceRows.data.map((l) => [l.id, l.name])));
      })
      .finally(() => setEventLoaded(true));
    return () => controller.abort();
  }, [eventId, t]);

  const labels = useMemo(() => sheetLabels(t), [t]);

  const roundName = useCallback(
    (round: number, rounds: number): string => {
      const fromEnd = rounds - round;
      if (fromEnd === 0) return t('organizer.printPack.roundFinal');
      if (fromEnd === 1) return t('organizer.printPack.roundSemiFinals');
      if (fromEnd === 2) return t('organizer.printPack.roundQuarterFinals');
      return t('organizer.printPack.roundOf', { count: 2 ** (fromEnd + 1) });
    },
    [t],
  );

  /** Each pack that has a bout to print; the time is stamped when Print is pressed. */
  const printable = useMemo(
    () =>
      packs.packs
        .map((pack) =>
          packInput(pack, {
            eventName,
            timeZone: eventTz,
            generatedAt: '',
            lices,
            roundName,
            labels,
            sections,
          }),
        )
        .filter((input) => input.allMatches.length > 0),
    [packs.packs, eventName, eventTz, lices, roundName, labels, sections],
  );

  // Derived, never stored: the event list has to have landed, and the packs on
  // screen have to belong to the choice currently made.
  const loading = !eventLoaded || packs.loading;
  const canPrint = sections.length > 0 && printable.length > 0;

  function toggleSection(key: PrintSectionKey) {
    setSections((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  function handlePrint() {
    if (!canPrint) return;
    const generatedAt = new Date().toLocaleString(localeToBcp47(locale));
    const inputs = printable.map((input) => ({ ...input, meta: { ...input.meta, generatedAt } }));
    const html =
      selected === ALL_TOURNAMENTS
        ? printJoinedPacksHtml(eventName, inputs)
        : printPackHtml(inputs[0]!);

    openPrintWindow(html, () => setError(t('organizer.printWindow.popupBlocked')));
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2 text-sm text-muted">
        <OrgCrumb slug={slug} className="hover:text-foreground-secondary" />
        <span>/</span>
        <EventCrumb
          slug={slug}
          eventId={eventId}
          className="hover:text-foreground-secondary"
          fallback={t('organizer.finalRanking.breadcrumbEvent')}
        />
        <span>/</span>
        <span className="font-medium text-foreground">{t('organizer.printPack.breadcrumb')}</span>
      </div>

      <h1 className="font-display text-2xl font-bold text-foreground">
        {t('organizer.printPack.title')}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted">{t('organizer.printPack.description')}</p>

      {tournaments.length > 1 && (
        <label className="mt-6 block">
          <span className="text-sm font-semibold text-foreground">
            {t('organizer.printPack.tournamentLabel')}
          </span>
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            <option value={ALL_TOURNAMENTS}>{t('organizer.printPack.allTournaments')}</option>
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <h2 className="mt-6 text-sm font-semibold text-foreground">
        {t('organizer.printPack.sections')}
      </h2>
      <div className="mt-2 divide-y divide-border rounded-lg border border-border">
        {sectionList(t).map((section) => (
          <label
            key={section.key}
            className="flex cursor-pointer items-start gap-3 p-3 text-sm"
            htmlFor={`print-${section.key}`}
          >
            <input
              id={`print-${section.key}`}
              type="checkbox"
              checked={sections.includes(section.key)}
              onChange={() => toggleSection(section.key)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span>
              <span className="font-medium text-foreground">{section.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">{section.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {(error ?? packs.error) && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error ?? packs.error}
        </p>
      )}
      {!loading && printable.length === 0 && !(error ?? packs.error) && (
        <p className="mt-4 text-sm text-muted">{t('organizer.printPack.noData')}</p>
      )}
      {sections.length === 0 && (
        <p className="mt-4 text-sm text-muted">{t('organizer.printPack.nothingSelected')}</p>
      )}

      <button
        type="button"
        onClick={handlePrint}
        disabled={!canPrint || loading}
        className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? t('common.loading') : t('organizer.printPack.print')}
      </button>
    </main>
  );
}
