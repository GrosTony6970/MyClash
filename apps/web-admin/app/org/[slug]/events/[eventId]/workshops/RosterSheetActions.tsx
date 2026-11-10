'use client';

import { CsvExportMenu, statusLabel, useToast } from '@myclash/ui';
import { formatInZone, localeToBcp47, zonedDay } from '@myclash/time';
import type { CsvFormat } from '@myclash/types';
import { useI18n, type Translator } from '@myclash/next-i18n/client';
import { downloadCsv } from '@/lib/csv-file';
import { openPrintWindow } from '@/lib/print-window';
import { sessionTimeRange, type RowSession } from './workshop-row-sessions';
import {
  rosterCsvName,
  rosterSheetCsv,
  rosterSheetHtml,
  rosterSheetRows,
  type SheetEntry,
  type SheetHead,
  type SheetRow,
} from './roster-sheet';

export interface SheetSession extends RowSession {
  status: string | null;
}

export interface SheetWorkshop {
  title: string;
  slug: string;
  instructors: Array<{ displayName: string }>;
}

const BUTTON =
  'rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background disabled:opacity-50';

/** The heading of the sheet, in the reader's words. */
function sheetHead(
  workshop: SheetWorkshop,
  session: SheetSession,
  rows: readonly SheetRow[],
  tz: string,
  t: Translator,
  bcp47: string,
): SheetHead {
  const names = workshop.instructors.map((i) => i.displayName).join(', ');
  return {
    title: workshop.title,
    when: session.startsAt ? sessionTimeRange(session, tz, bcp47) : null,
    cancelled:
      session.status === 'cancelled' ? statusLabel('workshopSession', 'cancelled', t) : null,
    instructors: names ? t('organizer.workshopsPage.sheet.instructors', { names }) : null,
    counts: t('organizer.workshopsPage.sheet.counts', {
      seats: rows.filter((r) => r.waiting === null).length,
      waiting: rows.filter((r) => r.waiting !== null).length,
    }),
  };
}

interface SheetSource {
  workshop: SheetWorkshop;
  session: SheetSession;
  roster: readonly SheetEntry[];
  tz: string;
}

/** The sheet's lines, and its print and its CSV, in the reader's words. */
function useRosterSheet({ workshop, session, roster, tz }: SheetSource) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const rows = rosterSheetRows(roster, t('organizer.workshopsPage.unknownPerson'));
  const words = (key: string) => t(`organizer.workshopsPage.sheet.${key}`);

  function print() {
    const head = sheetHead(workshop, session, rows, tz, t, localeToBcp47(locale));
    const html = rosterSheetHtml(head, rows, {
      name: words('colName'),
      club: words('colClub'),
      place: words('colPlace'),
      present: words('colPresent'),
      seat: words('seat'),
      waitingAt: (position) =>
        t('organizer.workshopsPage.sheet.waitingAt', { position: position ?? '' }),
    });
    openPrintWindow(html, () => toast.error(t('organizer.printWindow.popupBlocked')));
  }

  function exportCsv(format: CsvFormat) {
    const headers = [
      words('colFamilyName'),
      words('colGivenName'),
      words('colClub'),
      words('colPlace'),
      words('colWaitingPosition'),
      words('colPresent'),
    ] as const;
    const bcp47 = localeToBcp47(locale);
    const csv = rosterSheetCsv(
      rows,
      headers,
      {
        seat: words('seat'),
        waiting: words('waiting'),
        presentAt: (iso) => formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, bcp47),
      },
      format,
    );
    downloadCsv(rosterCsvName(workshop.slug, zonedDay(session.startsAt, tz)), csv);
  }

  return { rows, print, exportCsv };
}

/**
 * "Print" and "Export CSV" at the top of a session's roster (operator ruling 537). Shown when the
 * sheet has someone on it; greyed while the roster is read again, since the list on screen may be
 * the one from before a Remove or an add.
 */
export function RosterSheetActions({ rereading, ...source }: SheetSource & { rereading: boolean }) {
  const { t, locale } = useI18n();
  const sheet = useRosterSheet(source);
  if (sheet.rows.length === 0) return null;

  return (
    <div className="mb-3 flex justify-end gap-2">
      <CsvExportMenu
        t={t}
        locale={locale}
        label={t('organizer.schedulePage.grid.exportCsv')}
        onExport={sheet.exportCsv}
        disabled={rereading}
        className={BUTTON}
      />
      <button type="button" onClick={sheet.print} disabled={rereading} className={BUTTON}>
        {t('organizer.schedulePage.grid.print')}
      </button>
    </div>
  );
}
