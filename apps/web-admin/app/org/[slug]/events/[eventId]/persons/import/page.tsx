'use client';

/**
 * CSV import wizard — T-703
 * Route: /org/[slug]/events/[eventId]/persons/import
 *
 * Steps: Upload → Preview/Validate → Commit
 */

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface ImportReport {
  created: number;
  updated: number;
  duplicates: Array<{ row: number; name: string; existingEmail: string }>;
  invalid: Array<{ row: number; reason: string; raw: string }>;
  newClubsForReview: string[];
}

type Step = 'upload' | 'preview' | 'done';

export default function CsvImportPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
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
        throw new Error(body.message ?? 'Upload failed');
      }

      setReport((await res.json()) as ImportReport);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleCommit() {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/persons/import`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Import failed');
      }

      setReport((await res.json()) as ImportReport);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="p-8 max-w-2xl">
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
            <p className="text-gray-500 text-sm mb-3">
              CSV format:{' '}
              <code className="bg-gray-100 px-1 rounded text-xs">
                given_name, family_name, email, club, hema_ratings_id
              </code>
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
            onClick={() => void handleUpload()}
            disabled={!file || uploading}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors self-end"
          >
            {uploading ? 'Validating…' : 'Validate →'}
          </button>
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === 'preview' && report && (
        <div className="flex flex-col gap-4">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              {
                label: 'Will create',
                value: report.created,
                color: 'text-green-700 bg-green-50 border-green-200',
              },
              {
                label: 'Will update',
                value: report.updated,
                color: 'text-blue-700 bg-blue-50 border-blue-200',
              },
              {
                label: 'Duplicates',
                value: report.duplicates.length,
                color: 'text-yellow-700 bg-yellow-50 border-yellow-200',
              },
              {
                label: 'Invalid',
                value: report.invalid.length,
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
          {report.newClubsForReview.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <p className="font-medium text-amber-700 mb-1">New clubs to review:</p>
              <div className="flex flex-wrap gap-1">
                {report.newClubsForReview.map((c) => (
                  <span key={c} className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Invalid rows */}
          {report.invalid.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Invalid rows (will be skipped):
              </p>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {report.invalid.map((inv) => (
                  <div
                    key={inv.row}
                    className="text-xs bg-red-50 border border-red-100 rounded px-3 py-1.5"
                  >
                    <span className="font-mono text-red-600">Row {inv.row}:</span> {inv.reason}
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
              disabled={uploading || report.created + report.updated === 0}
              className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
            >
              {uploading ? 'Importing…' : `Import ${report.created + report.updated} persons`}
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
            (duplicates) · {report.invalid.length} invalid
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
