'use client';

/**
 * CSV import wizard — T-703 / T-1208
 * Steps: Upload → Preview (with conflict cards) → Commit → Done
 */

import { useRef, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import type {
  CsvImportReport,
  ImportDecision,
  ImportPreviewResponse,
  PreviewRow,
} from '@myclash/types';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

type Step = 'upload' | 'preview' | 'done';

const TONES = {
  green: {
    chip: 'bg-success/10 text-success',
    border: 'border-success/30',
    text: 'text-success',
  },
  amber: {
    chip: 'bg-warning/10 text-warning',
    border: 'border-warning/30',
    text: 'text-warning',
  },
  red: {
    chip: 'bg-danger/10 text-danger',
    border: 'border-danger/30',
    text: 'text-danger',
  },
} as const;

type SectionTone = keyof typeof TONES;

/**
 * Collapsible "what's in this bucket" section with a count chip
 * in the header. Auto-opens when small (≤ 10 rows) so short
 * imports show everything at a glance; collapses on big ones so
 * the operator can scan headings first.
 */
function SectionAccordion({
  title,
  count,
  tone,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  tone: SectionTone;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  const t = TONES[tone];
  return (
    <div className={`rounded-lg border ${t.border} bg-surface`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-t-lg px-4 py-2.5 text-left text-sm hover:bg-background"
        aria-expanded={open}
      >
        <span className={`font-semibold ${t.text}`}>{title}</span>
        <span className="flex items-center gap-2">
          <span className={`rounded-full ${t.chip} px-2.5 py-0.5 text-xs font-bold`}>{count}</span>
          <span className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
        </span>
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  );
}

const CONFIDENCE_LABEL_KEYS: Record<string, string> = {
  exact_abv: 'organizer.personsImport.confidenceExactAbv',
  high: 'organizer.personsImport.confidenceHigh',
  medium: 'organizer.personsImport.confidenceMedium',
  new: 'organizer.personsImport.confidenceNew',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  exact_abv: 'bg-success/10 text-success',
  high: 'bg-success/10 text-success',
  medium: 'bg-warning/10 text-warning',
  new: 'bg-info/10 text-info',
};

function ConflictCard({
  row,
  decision,
  onDecide,
}: {
  row: PreviewRow;
  decision: 'link' | 'create_new';
  onDecide: (rowIndex: number, action: 'link' | 'create_new') => void;
}) {
  const { t } = useI18n();
  const match = row.globalPersonMatch!;
  return (
    <div className="border border-warning/30 bg-warning/10 rounded-lg p-4 text-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="font-semibold text-foreground">
            {t('organizer.personsImport.rowPrefix', { n: row.index + 1 })} {row.givenName}{' '}
            {row.familyName}
          </p>
          {row.email && <p className="text-muted text-xs">{row.email}</p>}
          {row.clubResolution && (
            <p className="text-xs mt-0.5">
              {t('organizer.personsImport.clubPrefix')}{' '}
              <span className="font-medium">{row.clubResolution.resolvedName}</span>
              {row.clubResolution.abbreviation && (
                <span className="ml-1 text-muted">({row.clubResolution.abbreviation})</span>
              )}
              <span
                className={`ml-2 px-1.5 py-0.5 rounded text-xs ${CONFIDENCE_COLORS[row.clubResolution.confidence] ?? 'bg-border text-foreground-secondary'}`}
              >
                {CONFIDENCE_LABEL_KEYS[row.clubResolution.confidence]
                  ? t(CONFIDENCE_LABEL_KEYS[row.clubResolution.confidence]!)
                  : row.clubResolution.confidence}
              </span>
            </p>
          )}
        </div>
      </div>
      <div className="bg-surface border border-warning/30 rounded-md p-2 mb-3 text-xs">
        <p className="text-warning font-medium mb-1">
          {t('organizer.personsImport.globalProfileFound')}
        </p>
        <p className="font-semibold text-foreground">{match.displayName}</p>
        {(match.clubName || match.abbreviation) && (
          <p className="text-muted">
            {match.clubName}
            {match.abbreviation && ` (${match.abbreviation})`}
          </p>
        )}
        {match.email && <p className="text-muted">{match.email}</p>}
      </div>
      <div className="flex gap-4">
        {(['link', 'create_new'] as const).map((action) => (
          <label key={action} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name={`decision-${row.index}`}
              value={action}
              checked={decision === action}
              onChange={() => onDecide(row.index, action)}
              className="accent-accent"
            />
            <span className={decision === action ? 'font-medium text-foreground' : 'text-muted'}>
              {action === 'link'
                ? t('organizer.personsImport.decisionLink')
                : t('organizer.personsImport.decisionCreate')}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function CsvImportPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [report, setReport] = useState<CsvImportReport | null>(null);
  const [decisions, setDecisions] = useState<Record<number, 'link' | 'create_new'>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function decide(rowIndex: number, action: 'link' | 'create_new') {
    setDecisions((prev) => ({ ...prev, [rowIndex]: action }));
  }

  async function handlePreview() {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const r = await apiRequest<ImportPreviewResponse>(
        apiUrl,
        `/api/v1/events/${eventId}/persons/import/preview`,
        { method: 'POST', body: formData },
      );
      if (!r.ok) {
        // The importer names the row and column it choked on — exactly what an
        // operator fixing a spreadsheet needs.
        const message = failureMessage(r, t, t('admin.common.previewFailed'));
        if (message) setError(message);
        return;
      }

      const data = r.data;
      setPreview(data);

      // Seed default decisions from server recommendations
      const defaults: Record<number, 'link' | 'create_new'> = {};
      for (const row of data.rows) {
        defaults[row.index] = row.defaultAction;
      }
      setDecisions(defaults);

      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.previewFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function handleCommit() {
    if (!file || !preview) return;
    setUploading(true);
    setError(null);

    try {
      const decisionPayload: ImportDecision[] = preview.rows
        .filter((r) => r.status === 'ok' && r.globalPersonMatch)
        .map((r) => ({
          rowIndex: r.index,
          action: decisions[r.index] ?? r.defaultAction,
          globalPersonId:
            (decisions[r.index] ?? r.defaultAction) === 'link'
              ? r.globalPersonMatch!.id
              : undefined,
        }));

      const formData = new FormData();
      formData.append('file', file);
      if (decisionPayload.length > 0) {
        formData.append('decisions', JSON.stringify(decisionPayload));
      }

      const r = await apiRequest<CsvImportReport>(
        apiUrl,
        `/api/v1/events/${eventId}/persons/import`,
        { method: 'POST', body: formData },
      );
      if (!r.ok) {
        const message = failureMessage(r, t, t('admin.common.importFailed'));
        if (message) setError(message);
        return;
      }

      setReport(r.data);
      setStep('done');
    } finally {
      setUploading(false);
    }
  }

  const okRows = preview?.rows.filter((r) => r.status === 'ok') ?? [];
  const conflictRows = okRows.filter((r) => r.globalPersonMatch);
  const cleanRows = okRows.filter((r) => !r.globalPersonMatch);

  return (
    <main className="mx-auto p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-muted mb-1">
        <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
          {slug}
        </Link>
        <span>/</span>
        <Link
          href={`/org/${slug}/events/${eventId}/persons`}
          className="hover:text-foreground-secondary"
        >
          {t('organizer.personsImport.breadcrumbPersons')}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">
          {t('organizer.personsImport.breadcrumbCsvImport')}
        </span>
      </div>
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-6">
        {t('organizer.personsImport.title')}
      </h1>

      {/* Step indicator */}
      <div className="flex items-center gap-4 mb-8 text-sm">
        {(['upload', 'preview', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={[
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                step === s
                  ? 'bg-accent text-accent-foreground'
                  : i < ['upload', 'preview', 'done'].indexOf(step)
                    ? 'bg-success text-success-foreground'
                    : 'bg-border text-muted',
              ].join(' ')}
            >
              {i + 1}
            </div>
            <span className={step === s ? 'font-semibold text-foreground' : 'text-muted'}>
              {s === 'upload'
                ? t('organizer.personsImport.stepUpload')
                : s === 'preview'
                  ? t('organizer.personsImport.stepPreview')
                  : t('organizer.personsImport.stepDone')}
            </span>
            {i < 2 && <div className="w-8 h-px bg-border" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* ── Step: Upload ── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
            <p className="text-muted text-sm mb-1">
              {t('organizer.personsImport.csvColumnsLabel')}
            </p>
            <p className="font-mono text-xs text-muted mb-3">
              {'given_name, family_name, email, club, club_abv, club_city, hema_ratings_id'}
            </p>
            <input
              ref={fileRef}
              data-testid="import-file-input"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              {t('organizer.personsImport.chooseFile')}
            </button>
            {file && (
              <p className="text-sm text-foreground-secondary mt-2">
                {t('organizer.personsImport.selectedLabel')} <strong>{file.name}</strong>{' '}
                {t('organizer.personsImport.sizeKb', { size: (file.size / 1024).toFixed(1) })}
              </p>
            )}
          </div>

          <button
            onClick={() => void handlePreview()}
            data-testid="import-validate"
            disabled={!file || uploading}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-6 rounded-lg text-sm transition-colors self-end"
          >
            {uploading
              ? t('organizer.personsImport.validating')
              : t('organizer.personsImport.validate')}
          </button>
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === 'preview' &&
        preview &&
        (() => {
          const invalidRows = preview.rows.filter((r) => r.status === 'invalid');
          // Counts driven by current decisions so the bar + section
          // chips react as the operator changes radios.
          const willLink = conflictRows.filter(
            (r) => (decisions[r.index] ?? r.defaultAction) === 'link',
          ).length;
          const willCreate =
            cleanRows.length +
            conflictRows.filter((r) => (decisions[r.index] ?? r.defaultAction) === 'create_new')
              .length;
          const notYetLinkedCount = conflictRows.filter(
            (r) => (decisions[r.index] ?? r.defaultAction) !== 'link',
          ).length;
          const notYetCreateNewCount = conflictRows.filter(
            (r) => (decisions[r.index] ?? r.defaultAction) !== 'create_new',
          ).length;

          function linkAllSuggested() {
            setDecisions((prev) => {
              const next = { ...prev };
              for (const r of conflictRows) next[r.index] = 'link';
              return next;
            });
          }
          function createAllAsNew() {
            setDecisions((prev) => {
              const next = { ...prev };
              for (const r of conflictRows) next[r.index] = 'create_new';
              return next;
            });
          }

          return (
            <div className="flex flex-col gap-4">
              {/* Sticky action bar — summary chips + bulk shortcuts +
                  Cancel/Import. Stays pinned while the operator
                  scrolls through the section bodies below. */}
              <div className="sticky top-0 z-sticky flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 text-sm shadow-sm backdrop-blur">
                <div className="flex flex-wrap items-center gap-3 text-foreground-secondary">
                  <span>
                    <strong>{preview.rows.length}</strong> {t('organizer.personsImport.rowsChip')}
                  </span>
                  <span className="text-success">
                    <strong>{willCreate}</strong> {t('organizer.personsImport.willCreateChip')}
                  </span>
                  <span className="text-info">
                    <strong>{willLink}</strong> {t('organizer.personsImport.willLinkChip')}
                  </span>
                  <span className="text-danger">
                    <strong>{invalidRows.length}</strong> {t('organizer.personsImport.invalidChip')}
                  </span>
                  {preview.newClubs.length > 0 && (
                    <span className="text-info">
                      {preview.newClubs.length === 1
                        ? t('organizer.personsImport.newClubsChipSingular', {
                            count: preview.newClubs.length,
                          })
                        : t('organizer.personsImport.newClubsChipPlural', {
                            count: preview.newClubs.length,
                          })}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {conflictRows.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={linkAllSuggested}
                        disabled={notYetLinkedCount === 0}
                        className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1 text-xs font-semibold text-info hover:bg-info/20 disabled:opacity-50"
                      >
                        {t('organizer.personsImport.linkAllSuggested')}
                        {notYetLinkedCount > 0 ? ` (${notYetLinkedCount})` : ''}
                      </button>
                      <button
                        type="button"
                        onClick={createAllAsNew}
                        disabled={notYetCreateNewCount === 0}
                        className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
                      >
                        {t('organizer.personsImport.createAllAsNew')}
                        {notYetCreateNewCount > 0 ? ` (${notYetCreateNewCount})` : ''}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep('upload')}
                    disabled={uploading}
                    className="text-sm text-muted hover:text-foreground-secondary disabled:opacity-50"
                  >
                    {t('organizer.personsImport.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCommit()}
                    data-testid="import-commit"
                    disabled={uploading || willCreate + willLink === 0}
                    className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    {uploading
                      ? t('organizer.personsImport.importing')
                      : t('organizer.personsImport.importButton', {
                          count: willCreate + willLink,
                        })}
                  </button>
                </div>
              </div>

              {/* Side-effect callout: new clubs that will be created. */}
              {preview.newClubs.length > 0 && (
                <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-sm">
                  <p className="mb-1 font-medium text-info">
                    {t('organizer.personsImport.newClubsCallout')}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {preview.newClubs.map((c) => (
                      <span key={c} className="rounded bg-info/10 px-2 py-0.5 text-xs text-info">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Will create — clean rows (no global match). */}
              <SectionAccordion
                title={t('organizer.personsImport.sectionWillCreate')}
                count={cleanRows.length}
                tone="green"
                defaultOpen={cleanRows.length <= 10}
              >
                <div className="flex flex-col gap-1">
                  {cleanRows.map((row) => (
                    <div
                      key={row.index}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-success/30 bg-success/5 px-3 py-1.5 text-xs"
                    >
                      <span>
                        <span className="font-mono text-success">
                          {t('organizer.personsImport.rowPrefix', { n: row.index + 1 })}
                        </span>{' '}
                        <span className="font-medium text-foreground">
                          {row.givenName} {row.familyName}
                        </span>
                        {row.email && <span className="ml-2 text-muted">{row.email}</span>}
                      </span>
                      {row.clubResolution && (
                        <span className="text-foreground-secondary">
                          {row.clubResolution.resolvedName}
                          {row.clubResolution.abbreviation && (
                            <span className="ml-1 text-muted">
                              ({row.clubResolution.abbreviation})
                            </span>
                          )}
                          <span
                            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${CONFIDENCE_COLORS[row.clubResolution.confidence] ?? 'bg-border text-foreground-secondary'}`}
                          >
                            {CONFIDENCE_LABEL_KEYS[row.clubResolution.confidence]
                              ? t(CONFIDENCE_LABEL_KEYS[row.clubResolution.confidence]!)
                              : row.clubResolution.confidence}
                          </span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </SectionAccordion>

              {/* Duplicates — conflict rows; ConflictCard radios let
                  the operator change link vs create_new per row. */}
              <SectionAccordion
                title={t('organizer.personsImport.sectionDuplicates')}
                count={conflictRows.length}
                tone="amber"
                defaultOpen={conflictRows.length <= 10}
              >
                <div className="flex flex-col gap-3">
                  {conflictRows.map((row) => (
                    <ConflictCard
                      key={row.index}
                      row={row}
                      decision={decisions[row.index] ?? row.defaultAction}
                      onDecide={decide}
                    />
                  ))}
                </div>
              </SectionAccordion>

              {/* Invalid — auto-skipped on import. */}
              <SectionAccordion
                title={t('organizer.personsImport.sectionInvalid')}
                count={invalidRows.length}
                tone="red"
                defaultOpen={invalidRows.length <= 10}
              >
                <div className="flex flex-col gap-1">
                  {invalidRows.map((r) => (
                    <div
                      key={r.index}
                      className="rounded border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono text-danger">
                        {t('organizer.personsImport.rowPrefix', { n: r.index + 1 })}
                      </span>{' '}
                      {r.invalidReason}
                    </div>
                  ))}
                </div>
              </SectionAccordion>
            </div>
          );
        })()}

      {/* ── Step: Done ── */}
      {step === 'done' && report && (
        <div className="text-center py-8">
          <p className="text-4xl mb-3">✅</p>
          <h2 className="font-display font-semibold text-lg sm:text-xl mb-2">
            {t('organizer.personsImport.doneTitle')}
          </h2>
          <p className="text-muted text-sm mb-6">
            {t('organizer.personsImport.doneSummary', {
              created: report.created,
              updated: report.updated,
              skipped: report.duplicates.length,
              invalid: report.invalid.length,
            })}
          </p>
          {report.unmatchableIdentities.length > 0 && (
            /* These rows minted an identity with nothing to match on next time.
               Named rather than counted: the fix is per person — give them a
               club, a HEMA Ratings id or an email — so the organiser needs to
               know who, not how many. */
            <div className="mx-auto mb-6 max-w-xl rounded-lg border border-warning/30 bg-warning/10 p-4 text-left">
              <p className="text-sm font-semibold text-warning">
                {t('organizer.personsImport.unmatchableTitle', {
                  count: report.unmatchableIdentities.length,
                })}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t('organizer.personsImport.unmatchableBody')}
              </p>
              <p className="mt-2 text-xs text-foreground-secondary">
                {report.unmatchableIdentities.join(', ')}
              </p>
            </div>
          )}
          <button
            onClick={() => router.push(`/org/${slug}/events/${eventId}/persons`)}
            className="bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
          >
            {t('organizer.personsImport.backToRoster')}
          </button>
        </div>
      )}
    </main>
  );
}
