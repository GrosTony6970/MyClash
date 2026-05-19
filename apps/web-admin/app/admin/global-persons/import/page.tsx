'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Super admin: bulk import global persons from CSV.
 * Steps: Upload → Review (edit + per-row action) → Done
 */

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';

type RowStatus = 'ok' | 'invalid' | 'duplicate';
type RowAction = 'skip' | 'create_new' | 'overwrite';

interface PreviewRow {
  index: number;
  status: RowStatus;
  reasons: string[];
  duplicate: { id: string; displayName: string } | null;
  raw: string;
  fields: {
    givenName: string;
    familyName: string;
    displayName: string;
    hemaRatingsId: string | null;
    clubLabel: string | null;
    clubAbbreviation: string | null;
    clubCity: string | null;
    isFighter: boolean;
    isReferee: boolean;
    isWorkshopParticipant: boolean;
  };
}

interface PreviewResponse {
  summary: { total: number; ok: number; invalid: number; duplicate: number };
  rows: PreviewRow[];
}

interface DecisionRow extends PreviewRow {
  action: RowAction;
}

interface CommitReport {
  created: number;
  updated: number;
  skipped: number;
  failed: Array<{ index: number; reason: string }>;
  newClubs: string[];
}

type Step = 'upload' | 'review' | 'done';

function defaultAction(status: RowStatus): RowAction {
  if (status === 'invalid') return 'skip';
  if (status === 'duplicate') return 'skip';
  return 'create_new';
}

export default function GlobalPersonsImportPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [report, setReport] = useState<CommitReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const decisionSummary = useMemo(() => {
    const acc = { skip: 0, create_new: 0, overwrite: 0 };
    for (const row of decisions) acc[row.action]++;
    return acc;
  }, [decisions]);

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiUrl}/api/v1/global-persons/import/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Preview failed');
      }
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
      setDecisions(data.rows.map((row) => ({ ...row, action: defaultAction(row.status) })));
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        decisions: decisions.map((row) => ({
          index: row.index,
          action: row.action,
          targetGlobalPersonId: row.duplicate?.id,
          givenName: row.fields.givenName,
          familyName: row.fields.familyName,
          displayName: row.fields.displayName,
          hemaRatingsId: row.fields.hemaRatingsId ?? undefined,
          clubLabel: row.fields.clubLabel ?? undefined,
          clubAbbreviation: row.fields.clubAbbreviation ?? undefined,
          clubCity: row.fields.clubCity ?? undefined,
          isFighter: row.fields.isFighter,
          isReferee: row.fields.isReferee,
          isWorkshopParticipant: row.fields.isWorkshopParticipant,
        })),
      };
      const res = await fetch(`${apiUrl}/api/v1/global-persons/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? 'Commit failed');
      }
      setReport((await res.json()) as CommitReport);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed');
    } finally {
      setBusy(false);
    }
  }

  function updateRow(index: number, patch: Partial<DecisionRow>) {
    setDecisions((prev) => prev.map((row) => (row.index === index ? { ...row, ...patch } : row)));
  }

  function updateRowField(index: number, key: keyof DecisionRow['fields'], value: unknown) {
    setDecisions((prev) =>
      prev.map((row) =>
        row.index === index ? { ...row, fields: { ...row.fields, [key]: value } } : row,
      ),
    );
  }

  function skipAllInvalid() {
    setDecisions((prev) =>
      prev.map((row) => (row.status === 'invalid' ? { ...row, action: 'skip' } : row)),
    );
  }

  function skipAllDuplicates() {
    setDecisions((prev) =>
      prev.map((row) => (row.status === 'duplicate' ? { ...row, action: 'skip' } : row)),
    );
  }

  function reset() {
    setStep('upload');
    setFile(null);
    setPreview(null);
    setDecisions([]);
    setReport(null);
    setError(null);
  }

  const totalImported = (report?.created ?? 0) + (report?.updated ?? 0);

  return (
    <main className="p-8 max-w-7xl">
      <h1 className="text-2xl font-bold mb-1">Import Global Profiles</h1>
      <p className="text-slate-500 text-sm mb-6">
        Bulk-create or update global profiles from a CSV file. Review each row before committing.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <div className="flex flex-col gap-5 max-w-2xl">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm">
            <p className="font-medium text-slate-700 mb-2">Expected CSV columns:</p>
            <p className="font-mono text-xs text-slate-500 mb-3">
              given_name, family_name, display_name, club, club_abv, club_city, hema_ratings_id,
              is_fighter, is_referee, is_workshop_participant
            </p>
            <p className="text-xs text-slate-500">
              The next step will show every parsed row plus duplicates with the existing profile,
              and let you edit each field before commit.
            </p>
          </div>

          <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="border border-slate-300 hover:border-slate-400 text-slate-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              Choose CSV file
            </button>
            {file && (
              <p className="text-sm text-slate-600 mt-2">
                <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={!file || busy}
            className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors self-end"
          >
            {busy ? 'Reading…' : 'Preview →'}
          </button>
        </div>
      )}

      {step === 'review' && preview && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <div className="flex flex-wrap gap-4 text-slate-700">
              <span>
                <strong>{preview.summary.total}</strong> rows
              </span>
              <span className="text-green-700">
                <strong>{preview.summary.ok}</strong> ok
              </span>
              <span className="text-amber-700">
                <strong>{preview.summary.duplicate}</strong> duplicate
              </span>
              <span className="text-red-700">
                <strong>{preview.summary.invalid}</strong> invalid
              </span>
              <span className="text-slate-500">
                | will create <strong>{decisionSummary.create_new}</strong>, overwrite{' '}
                <strong>{decisionSummary.overwrite}</strong>, skip{' '}
                <strong>{decisionSummary.skip}</strong>
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={skipAllInvalid}
                className="text-xs border border-slate-300 px-2 py-1 rounded hover:bg-white"
              >
                Skip all invalid
              </button>
              <button
                type="button"
                onClick={skipAllDuplicates}
                className="text-xs border border-slate-300 px-2 py-1 rounded hover:bg-white"
              >
                Skip all duplicates
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Given name</th>
                  <th className="px-3 py-2">Family name</th>
                  <th className="px-3 py-2">Display name</th>
                  <th className="px-3 py-2">Club</th>
                  <th className="px-3 py-2">HEMA ID</th>
                  <th className="px-3 py-2">Roles</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((row) => {
                  const muted = row.action === 'skip' || row.status === 'invalid';
                  return (
                    <tr
                      key={row.index}
                      className={[
                        'border-b border-slate-100 align-top',
                        muted ? 'bg-slate-50/60 opacity-60' : '',
                        row.status === 'invalid' ? 'bg-red-50/50' : '',
                        row.status === 'duplicate' ? 'bg-amber-50/40' : '',
                      ].join(' ')}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">#{row.index}</td>
                      <td className="px-3 py-2">
                        {row.status === 'invalid' ? (
                          <span className="text-xs text-slate-400 italic">skip</span>
                        ) : (
                          <select
                            value={row.action}
                            onChange={(e) =>
                              updateRow(row.index, { action: e.target.value as RowAction })
                            }
                            className="border border-slate-300 rounded px-2 py-1 text-xs"
                          >
                            <option value="skip">Skip</option>
                            <option value="create_new">Create new</option>
                            {row.duplicate && <option value="overwrite">Overwrite</option>}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.givenName}
                          onChange={(e) => updateRowField(row.index, 'givenName', e.target.value)}
                          className="w-28 border border-slate-200 rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.familyName}
                          onChange={(e) => updateRowField(row.index, 'familyName', e.target.value)}
                          className="w-28 border border-slate-200 rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.displayName}
                          onChange={(e) => updateRowField(row.index, 'displayName', e.target.value)}
                          className="w-32 border border-slate-200 rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.clubLabel ?? ''}
                          onChange={(e) =>
                            updateRowField(row.index, 'clubLabel', e.target.value || null)
                          }
                          placeholder="Club"
                          className="w-32 border border-slate-200 rounded px-2 py-1 text-xs mb-1"
                          disabled={row.action === 'skip'}
                        />
                        <input
                          value={row.fields.clubAbbreviation ?? ''}
                          onChange={(e) =>
                            updateRowField(row.index, 'clubAbbreviation', e.target.value || null)
                          }
                          placeholder="Abv"
                          className="w-32 border border-slate-200 rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.hemaRatingsId ?? ''}
                          onChange={(e) =>
                            updateRowField(row.index, 'hemaRatingsId', e.target.value || null)
                          }
                          className="w-24 border border-slate-200 rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <label className="block text-xs">
                          <input
                            type="checkbox"
                            checked={row.fields.isFighter}
                            onChange={(e) =>
                              updateRowField(row.index, 'isFighter', e.target.checked)
                            }
                            disabled={row.action === 'skip'}
                          />{' '}
                          F
                        </label>
                        <label className="block text-xs">
                          <input
                            type="checkbox"
                            checked={row.fields.isReferee}
                            onChange={(e) =>
                              updateRowField(row.index, 'isReferee', e.target.checked)
                            }
                            disabled={row.action === 'skip'}
                          />{' '}
                          R
                        </label>
                        <label className="block text-xs">
                          <input
                            type="checkbox"
                            checked={row.fields.isWorkshopParticipant}
                            onChange={(e) =>
                              updateRowField(row.index, 'isWorkshopParticipant', e.target.checked)
                            }
                            disabled={row.action === 'skip'}
                          />{' '}
                          W
                        </label>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.status === 'invalid' && (
                          <span className="text-red-700">
                            Invalid: {row.reasons.join(', ') || 'unknown'}
                          </span>
                        )}
                        {row.status === 'duplicate' && row.duplicate && (
                          <span className="text-amber-700">
                            Duplicate of <strong>{row.duplicate.displayName}</strong>
                          </span>
                        )}
                        {row.status === 'ok' && <span className="text-green-700">OK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={busy}
              className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
            >
              {busy
                ? 'Importing…'
                : `Commit (${decisionSummary.create_new + decisionSummary.overwrite})`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && report && (
        <div className="max-w-2xl">
          {totalImported > 0 ? (
            <div className="text-center py-6 mb-6">
              <p className="text-4xl mb-3">✅</p>
              <h2 className="text-xl font-bold mb-2">Import complete</h2>
              <p className="text-sm text-slate-500">
                Imported {report.created} new, updated {report.updated}.
              </p>
            </div>
          ) : (
            <div className="text-center py-6 mb-6 rounded-lg border border-amber-200 bg-amber-50">
              <p className="text-4xl mb-3">⚠️</p>
              <h2 className="text-xl font-bold mb-2 text-amber-900">Nothing was imported.</h2>
              <p className="text-sm text-amber-800">
                No rows were created or updated. See per-row reasons below.
              </p>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              {
                label: 'Created',
                value: report.created,
                color: 'text-green-700 bg-green-50 border-green-200',
              },
              {
                label: 'Updated',
                value: report.updated,
                color: 'text-blue-700 bg-blue-50 border-blue-200',
              },
              {
                label: 'Skipped',
                value: report.skipped,
                color: 'text-slate-700 bg-slate-50 border-slate-200',
              },
              {
                label: 'Failed',
                value: report.failed.length,
                color: 'text-red-700 bg-red-50 border-red-200',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className={`border rounded-lg p-3 text-center ${color}`}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>

          {report.failed.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm mb-5">
              <p className="font-medium text-red-700 mb-2">Failed rows:</p>
              <ul className="space-y-0.5 text-xs text-red-800 list-disc list-inside">
                {report.failed.map((f) => (
                  <li key={f.index}>
                    Row #{f.index}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              type="button"
              onClick={reset}
              className="border border-slate-300 hover:border-slate-400 text-slate-700 font-medium py-2 px-4 rounded-lg text-sm"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
