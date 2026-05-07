'use client';

/**
 * CSV import wizard — T-703 / T-1208
 * Steps: Upload → Preview (with conflict cards) → Commit → Done
 */

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  CsvImportReport,
  ImportDecision,
  ImportPreviewResponse,
  PreviewRow,
} from '@myclash/types';

type Step = 'upload' | 'preview' | 'done';

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
            disabled={!file || uploading}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors self-end"
          >
            {uploading ? 'Validating…' : 'Validate →'}
          </button>
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === 'preview' && preview && (
        <div className="flex flex-col gap-5">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              {
                label: 'To create',
                value: preview.summary.toCreate,
                color: 'text-green-700 bg-green-50 border-green-200',
              },
              {
                label: 'To link',
                value: preview.summary.toLink,
                color: 'text-blue-700 bg-blue-50 border-blue-200',
              },
              {
                label: 'Duplicates',
                value: preview.summary.duplicates,
                color: 'text-yellow-700 bg-yellow-50 border-yellow-200',
              },
              {
                label: 'Invalid',
                value: preview.summary.invalid,
                color: 'text-red-700 bg-red-50 border-red-200',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className={`border rounded-lg p-3 text-center ${color}`}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>

          {/* New clubs */}
          {preview.newClubs.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p className="font-medium text-blue-700 mb-1">
                New clubs will be created (unverified):
              </p>
              <div className="flex flex-wrap gap-1">
                {preview.newClubs.map((c) => (
                  <span key={c} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Conflict cards — require organizer decision */}
          {conflictRows.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-amber-700 mb-2">
                {conflictRows.length} row{conflictRows.length !== 1 ? 's' : ''} matched an existing
                global profile — review and choose:
              </p>
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
            </div>
          )}

          {/* Clean rows summary */}
          {cleanRows.length > 0 && (
            <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
              <span className="font-medium text-gray-700">{cleanRows.length}</span> rows will be
              imported without conflict.
              {cleanRows.some((r) => r.clubResolution?.confidence === 'medium') && (
                <span className="ml-1 text-amber-600">
                  (some clubs matched via fuzzy search — verify after import)
                </span>
              )}
            </div>
          )}

          {/* Invalid rows */}
          {preview.rows.filter((r) => r.status === 'invalid').length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Invalid rows (will be skipped):
              </p>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {preview.rows
                  .filter((r) => r.status === 'invalid')
                  .map((r) => (
                    <div
                      key={r.index}
                      className="text-xs bg-red-50 border border-red-100 rounded px-3 py-1.5"
                    >
                      <span className="font-mono text-red-600">Row {r.index + 1}:</span>{' '}
                      {r.invalidReason}
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-2">
            <button
              onClick={() => setStep('upload')}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
            <button
              onClick={() => void handleCommit()}
              disabled={uploading || preview.summary.toCreate + preview.summary.toLink === 0}
              className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
            >
              {uploading
                ? 'Importing…'
                : `Import ${preview.summary.toCreate + preview.summary.toLink} persons`}
            </button>
          </div>
        </div>
      )}

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
