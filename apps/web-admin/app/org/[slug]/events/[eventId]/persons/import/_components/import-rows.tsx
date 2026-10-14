'use client';

/**
 * The rows a roster import skips or refuses, and its last screen (O17, ruled 2026-10-14):
 * each row shows its line in the file (the header is line 1), and why, in the reader's
 * language. The preview and the last screen list them the same way.
 */
import type { CsvImportReport, ImportRowProblem } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { importProblemText } from '@/lib/import-reasons';

/** "Line 4:", or nothing for a problem of the whole file. */
export function LineLabel({ line, className }: { line: number | null; className: string }) {
  const { t } = useI18n();
  if (line === null) return null;
  return (
    <span className={`font-mono ${className}`}>
      {t('organizer.personsImport.rowPrefix', { n: line })}
    </span>
  );
}

export interface ListedRow extends ImportRowProblem {
  key: string;
  line: number | null;
  name?: string;
}

const LIST_TONES = {
  danger: { row: 'border-danger/30 bg-danger/10', line: 'text-danger' },
  warning: { row: 'border-warning/30 bg-warning/10', line: 'text-warning' },
} as const;

export function ImportRowList({
  rows,
  tone,
}: {
  rows: ListedRow[];
  tone: keyof typeof LIST_TONES;
}) {
  const { t } = useI18n();
  const colors = LIST_TONES[tone];
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.key} className={`rounded border px-3 py-1.5 text-xs ${colors.row}`}>
          <LineLabel line={row.line} className={colors.line} />{' '}
          {row.name && <span className="font-medium text-foreground">{row.name} · </span>}
          {importProblemText(t, row)}
        </li>
      ))}
    </ul>
  );
}

/** The report's skipped and refused rows, ready for `ImportRowList`. */
export function reportRows(report: CsvImportReport) {
  return {
    skipped: report.duplicates.map(({ line, name, reason }): ListedRow => ({
      key: `d${line}`,
      line,
      name,
      reason,
    })),
    invalid: report.invalid.map(({ line, reason, value }, i): ListedRow => ({
      key: `i${i}`,
      line,
      reason,
      value,
    })),
  };
}

/**
 * People imported with nothing to match them on next time. Named rather than counted: the fix
 * is per person — give them a club, a HEMA Ratings id or an email — so the organiser needs to
 * know who, not how many.
 */
function UnmatchableNotice({ names }: { names: string[] }) {
  const { t } = useI18n();
  if (names.length === 0) return null;
  return (
    <div className="mx-auto mb-6 max-w-xl rounded-lg border border-warning/30 bg-warning/10 p-4 text-left">
      <p className="text-sm font-semibold text-warning">
        {t('organizer.personsImport.unmatchableTitle', { count: names.length })}
      </p>
      <p className="mt-1 text-xs text-muted">{t('organizer.personsImport.unmatchableBody')}</p>
      <p className="mt-2 text-xs text-foreground-secondary">{names.join(', ')}</p>
    </div>
  );
}

const DONE_TONES = { warning: 'text-warning', danger: 'text-danger' } as const;

function DoneList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: ListedRow[];
  tone: keyof typeof DONE_TONES;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mx-auto mb-4 max-w-xl">
      <h3 className={`mb-2 text-sm font-semibold ${DONE_TONES[tone]}`}>{title}</h3>
      <ImportRowList rows={rows} tone={tone} />
    </section>
  );
}

/** The last screen: what was created, then every row skipped or refused, by its line. */
export function ImportDone({ report, onBack }: { report: CsvImportReport; onBack: () => void }) {
  const { t } = useI18n();
  const { skipped, invalid } = reportRows(report);
  return (
    <div className="py-8">
      <div className="text-center">
        <p className="text-4xl mb-3">✅</p>
        <h2 className="font-display font-semibold text-lg sm:text-xl mb-2">
          {t('organizer.personsImport.doneTitle')}
        </h2>
        <p className="text-muted text-sm mb-6">
          {t('organizer.personsImport.doneSummary', {
            created: report.created,
            skipped: skipped.length,
            invalid: invalid.length,
          })}
        </p>
      </div>
      <UnmatchableNotice names={report.unmatchableIdentities} />
      <DoneList
        title={t('organizer.personsImport.doneSkippedTitle')}
        rows={skipped}
        tone="warning"
      />
      <DoneList
        title={t('organizer.personsImport.doneInvalidTitle')}
        rows={invalid}
        tone="danger"
      />
      <div className="mt-6 text-center">
        <button
          onClick={onBack}
          className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
        >
          {t('organizer.personsImport.backToRoster')}
        </button>
      </div>
    </div>
  );
}
