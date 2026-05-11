'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Super admin: bulk import global persons from CSV.
 * Steps: Upload → Review → Done
 */

import Link from 'next/link';
import { useRef, useState } from 'react';

interface GlobalPersonsImportReport {
  created: number;
  skipped: number;
  invalid: number;
  newClubs: string[];
}

type Step = 'upload' | 'done';

export default function GlobalPersonsImportPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [report, setReport] = useState<GlobalPersonsImportReport | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImport() {
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${apiUrl}/api/v1/global-persons/import`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Import failed');
      }

      setReport((await res.json()) as GlobalPersonsImportReport);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="p-8 max-w-2xl">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          Back to admin
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-1">Import global persons</h1>
      <p className="text-gray-500 text-sm mb-6">
        Bulk-create global fighter / referee / workshop profiles from a CSV file. Existing profiles
        (matched by name) are skipped.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <div className="flex flex-col gap-5">
          {/* Format card */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
            <p className="font-medium text-gray-700 mb-2">Expected CSV columns:</p>
            <p className="font-mono text-xs text-gray-500 mb-3">
              given_name, family_name, display_name (optional), club, club_abv, club_city,
              is_fighter, is_referee, is_workshop_participant
            </p>
            <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
              <li>
                <code>is_fighter</code> / <code>is_referee</code> /{' '}
                <code>is_workshop_participant</code>: use <code>true</code> or <code>1</code>
              </li>
              <li>Club matched by abbreviation first, then name; created as unverified if new</li>
              <li>
                Duplicate detection: case-insensitive full name match against existing profiles
              </li>
            </ul>
          </div>

          {/* File picker */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
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
                <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <button
            onClick={() => void handleImport()}
            disabled={!file || uploading}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors self-end"
          >
            {uploading ? 'Importing…' : 'Import →'}
          </button>
        </div>
      )}

      {step === 'done' && report && (
        <div>
          <div className="text-center py-6 mb-6">
            <p className="text-4xl mb-3">✅</p>
            <h2 className="text-xl font-bold mb-2">Import complete</h2>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              {
                label: 'Created',
                value: report.created,
                color: 'text-green-700 bg-green-50 border-green-200',
              },
              {
                label: 'Skipped (duplicate)',
                value: report.skipped,
                color: 'text-yellow-700 bg-yellow-50 border-yellow-200',
              },
              {
                label: 'Invalid rows',
                value: report.invalid,
                color: 'text-red-700 bg-red-50 border-red-200',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className={`border rounded-lg p-3 text-center ${color}`}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>

          {report.newClubs.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm mb-5">
              <p className="font-medium text-amber-700 mb-1">
                New unverified clubs created ({report.newClubs.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {report.newClubs.map((c) => (
                  <span key={c} className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs">
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-xs text-amber-600 mt-2">
                Review and verify these clubs in the{' '}
                <Link href="/admin/clubs" className="underline">
                  Clubs admin
                </Link>
                .
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStep('upload');
                setFile(null);
                setReport(null);
              }}
              className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm"
            >
              Import another file
            </button>
            <Link
              href="/admin"
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center"
            >
              Back to admin
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
