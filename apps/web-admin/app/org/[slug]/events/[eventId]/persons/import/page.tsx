'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * CSV import wizard — T-703 / T-1208
 * Steps: Upload → Preview (with conflict cards) → Commit → Done
 */

import { useRef, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  CsvImportReport,
  ImportDecision,
  ImportPreviewResponse,
  PreviewRow,
} from '@myclash/types';

type Step = 'upload' | 'preview' | 'done';

const TONES = {
  green: {
    chip: 'bg-green-100 text-green-700',
    border: 'border-green-200',
    text: 'text-green-700',
  },
  amber: {
    chip: 'bg-amber-100 text-amber-700',
    border: 'border-amber-200',
    text: 'text-amber-700',
  },
  red: {
    chip: 'bg-red-100 text-red-700',
    border: 'border-red-200',
    text: 'text-red-700',
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
    <div className={`rounded-lg border ${t.border} bg-white`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-t-lg px-4 py-2.5 text-left text-sm hover:bg-slate-50"
        aria-expanded={open}
      >
        <span className={`font-semibold ${t.text}`}>{title}</span>
        <span className="flex items-center gap-2">
          <span className={`rounded-full ${t.chip} px-2.5 py-0.5 text-xs font-bold`}>{count}</span>
          <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>
            ⌄
          </span>
        </span>
      </button>
      {open && <div className="border-t border-slate-100 p-3">{children}</div>}
    </div>
  );
}

const CONFIDENCE_LABELS: Record<string, string> = {
  exact_abv: 'abbreviation match',
  high: 'name match',
  medium: 'fuzzy match',
  new: 'new club',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  exact_abv: 'bg-green-100 text-green-700',
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  new: 'bg-blue-100 text-blue-700',
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
  const match = row.globalPersonMatch!;
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 text-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="font-semibold text-gray-900">
            Row {row.index + 1}: {row.givenName} {row.familyName}
          </p>
          {row.email && <p className="text-gray-500 text-xs">{row.email}</p>}
          {row.clubResolution && (
            <p className="text-xs mt-0.5">
              Club: <span className="font-medium">{row.clubResolution.resolvedName}</span>
              {row.clubResolution.abbreviation && (
                <span className="ml-1 text-gray-400">({row.clubResolution.abbreviation})</span>
              )}
              <span
                className={`ml-2 px-1.5 py-0.5 rounded text-xs ${CONFIDENCE_COLORS[row.clubResolution.confidence] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {CONFIDENCE_LABELS[row.clubResolution.confidence] ?? row.clubResolution.confidence}
              </span>
            </p>
          )}
        </div>
      </div>
      <div className="bg-white border border-amber-200 rounded-md p-2 mb-3 text-xs">
        <p className="text-amber-700 font-medium mb-1">Global profile found:</p>
        <p className="font-semibold text-gray-800">{match.displayName}</p>
        {(match.clubName || match.abbreviation) && (
          <p className="text-gray-500">
            {match.clubName}
            {match.abbreviation && ` (${match.abbreviation})`}
          </p>
        )}
        {match.email && <p className="text-gray-400">{match.email}</p>}
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
              className="accent-red-700"
            />
            <span className={decision === action ? 'font-medium text-gray-900' : 'text-gray-500'}>
              {action === 'link' ? 'Link to existing profile' : 'Create new profile'}
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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

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

      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/persons/import/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Preview failed');
      }

      const data = (await res.json()) as ImportPreviewResponse;
      setPreview(data);

      // Seed default decisions from server recommendations
      const defaults: Record<number, 'link' | 'create_new'> = {};
      for (const row of data.rows) {
        defaults[row.index] = row.defaultAction;
      }
      setDecisions(defaults);

      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
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

      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/persons/import`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Import failed');
      }

      setReport((await res.json()) as CsvImportReport);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  const okRows = preview?.rows.filter((r) => r.status === 'ok') ?? [];
  const conflictRows = okRows.filter((r) => r.globalPersonMatch);
  const cleanRows = okRows.filter((r) => !r.globalPersonMatch);

  return (
    <main className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
        <Link href={`/org/${slug}`} className="hover:text-gray-700">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/events/${eventId}/persons`} className="hover:text-gray-700">
          Persons
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">CSV import</span>
      </div>
      <h1 className="text-2xl font-bold mb-6">Import persons from CSV</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-4 mb-8 text-sm">
        {(['upload', 'preview', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={[
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                step === s
                  ? 'bg-red-700 text-white'
                  : i < ['upload', 'preview', 'done'].indexOf(step)
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-200 text-gray-500',
              ].join(' ')}
            >
              {i + 1}
            </div>
            <span className={step === s ? 'font-semibold text-gray-900' : 'text-gray-400'}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
            {i < 2 && <div className="w-8 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* ── Step: Upload ── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
            <p className="text-gray-500 text-sm mb-1">CSV columns (email optional):</p>
            <p className="font-mono text-xs text-gray-400 mb-3">
              given_name, family_name, email, club, club_abv, club_city, hema_ratings_id
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
              className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              Choose CSV file
            </button>
            {file && (
              <p className="text-sm text-gray-600 mt-2">
                Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <button
            onClick={() => void handlePreview()}
            data-testid="import-validate"
            disabled={!file || uploading}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors self-end"
          >
            {uploading ? 'Validating…' : 'Validate →'}
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
              <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/95 px-4 py-3 text-sm shadow-sm backdrop-blur">
                <div className="flex flex-wrap items-center gap-3 text-slate-700">
                  <span>
                    <strong>{preview.rows.length}</strong> rows
                  </span>
                  <span className="text-green-700">
                    <strong>{willCreate}</strong> will create
                  </span>
                  <span className="text-blue-700">
                    <strong>{willLink}</strong> will link
                  </span>
                  <span className="text-red-700">
                    <strong>{invalidRows.length}</strong> invalid
                  </span>
                  {preview.newClubs.length > 0 && (
                    <span className="text-blue-600">
                      + {preview.newClubs.length} new club
                      {preview.newClubs.length !== 1 ? 's' : ''}
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
                        className="rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        Link all suggested{notYetLinkedCount > 0 ? ` (${notYetLinkedCount})` : ''}
                      </button>
                      <button
                        type="button"
                        onClick={createAllAsNew}
                        disabled={notYetCreateNewCount === 0}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Create all as new
                        {notYetCreateNewCount > 0 ? ` (${notYetCreateNewCount})` : ''}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep('upload')}
                    disabled={uploading}
                    className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCommit()}
                    data-testid="import-commit"
                    disabled={uploading || willCreate + willLink === 0}
                    className="rounded-lg bg-red-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-50"
                  >
                    {uploading ? 'Importing…' : `Import ${willCreate + willLink} persons`}
                  </button>
                </div>
              </div>

              {/* Side-effect callout: new clubs that will be created. */}
              {preview.newClubs.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                  <p className="mb-1 font-medium text-blue-700">
                    New clubs will be created (unverified):
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {preview.newClubs.map((c) => (
                      <span
                        key={c}
                        className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Will create — clean rows (no global match). */}
              <SectionAccordion
                title="Will create"
                count={cleanRows.length}
                tone="green"
                defaultOpen={cleanRows.length <= 10}
              >
                <div className="flex flex-col gap-1">
                  {cleanRows.map((row) => (
                    <div
                      key={row.index}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-green-100 bg-green-50/50 px-3 py-1.5 text-xs"
                    >
                      <span>
                        <span className="font-mono text-green-700">Row {row.index + 1}:</span>{' '}
                        <span className="font-medium text-slate-800">
                          {row.givenName} {row.familyName}
                        </span>
                        {row.email && <span className="ml-2 text-slate-500">{row.email}</span>}
                      </span>
                      {row.clubResolution && (
                        <span className="text-slate-600">
                          {row.clubResolution.resolvedName}
                          {row.clubResolution.abbreviation && (
                            <span className="ml-1 text-slate-400">
                              ({row.clubResolution.abbreviation})
                            </span>
                          )}
                          <span
                            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${CONFIDENCE_COLORS[row.clubResolution.confidence] ?? 'bg-gray-100 text-gray-600'}`}
                          >
                            {CONFIDENCE_LABELS[row.clubResolution.confidence] ??
                              row.clubResolution.confidence}
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
                title="Duplicates (need a decision)"
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
                title="Invalid (will skip)"
                count={invalidRows.length}
                tone="red"
                defaultOpen={invalidRows.length <= 10}
              >
                <div className="flex flex-col gap-1">
                  {invalidRows.map((r) => (
                    <div
                      key={r.index}
                      className="rounded border border-red-100 bg-red-50 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono text-red-600">Row {r.index + 1}:</span>{' '}
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
          <h2 className="text-xl font-bold mb-2">Import complete</h2>
          <p className="text-gray-500 text-sm mb-6">
            {report.created} created · {report.updated} updated · {report.duplicates.length} skipped
            · {report.invalid.length} invalid
          </p>
          <button
            onClick={() => router.push(`/org/${slug}/events/${eventId}/persons`)}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
          >
            Back to roster
          </button>
        </div>
      )}
    </main>
  );
}
