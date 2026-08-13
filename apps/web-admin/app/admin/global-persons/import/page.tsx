'use client';

/**
 * Super admin: bulk import global persons from CSV.
 * Steps: Upload → Review (edit + per-row action) → Done
 */

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { getDateFormat } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

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
    email: string | null;
    dateOfBirth: string | null;
    clubLabel: string | null;
    clubAbbreviation: string | null;
    clubCity: string | null;
    genderCategory: string | null;
    weapons: string | null;
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
  const apiUrl = getPublicApiUrl();
  const { locale, t } = useI18n();
  const dateFormat = useMemo(() => getDateFormat(locale), [locale]);

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
        throw new Error(body.message ?? t('admin.common.previewFailed'));
      }
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
      setDecisions(data.rows.map((row) => ({ ...row, action: defaultAction(row.status) })));
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.previewFailed'));
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
          email: row.fields.email ?? undefined,
          dateOfBirth: row.fields.dateOfBirth ?? undefined,
          clubLabel: row.fields.clubLabel ?? undefined,
          clubAbbreviation: row.fields.clubAbbreviation ?? undefined,
          clubCity: row.fields.clubCity ?? undefined,
          genderCategory: row.fields.genderCategory ?? undefined,
          weapons: row.fields.weapons ?? undefined,
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
        throw new Error(data.message ?? t('admin.common.commitFailed'));
      }
      setReport((await res.json()) as CommitReport);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.commitFailed'));
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
    <main className="p-8 max-w-[110rem]">
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-1">
        {t('admin.globalPersonsImport.title')}
      </h1>
      <p className="text-muted text-sm mb-6">{t('admin.globalPersonsImport.subtitle')}</p>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <div className="flex flex-col gap-5 max-w-2xl">
          <div className="bg-background border border-border rounded-lg p-4 text-sm">
            <p className="font-medium text-foreground-secondary mb-2">
              {t('admin.globalPersonsImport.csvColumnsLabel')}
            </p>
            <p className="font-mono text-xs text-muted mb-3">
              {'given_name, family_name, display_name, club, club_abv, club_city, ' +
                'hema_ratings_id, email, date_of_birth, is_fighter, is_referee, ' +
                'is_workshop_participant'}
            </p>
            <p className="text-xs text-muted mb-3">{t('admin.globalPersonsImport.dobHint')}</p>
            <p className="text-xs text-muted mb-3">
              <a
                href="/csv-samples/global-persons.csv"
                download
                className="text-info hover:underline font-medium"
              >
                {t('admin.globalPersonsImport.downloadSample')}
              </a>
            </p>
            <p className="text-xs text-muted">{t('admin.globalPersonsImport.nextStepHint')}</p>
          </div>

          <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
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
              className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              {t('organizer.personsImport.chooseFile')}
            </button>
            {file && (
              <p className="text-sm text-foreground-secondary mt-2">
                <strong>{file.name}</strong>{' '}
                {t('organizer.personsImport.sizeKb', { size: (file.size / 1024).toFixed(1) })}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={!file || busy}
            className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-6 rounded-lg text-sm transition-colors self-end"
          >
            {busy
              ? t('admin.globalPersonsImport.reading')
              : t('admin.globalPersonsImport.previewButton')}
          </button>
        </div>
      )}

      {step === 'review' && preview && (
        <div className="flex flex-col gap-4">
          {/* Sticky summary bar — keeps the row counts AND the
              Cancel/Commit pair visible while the operator scrolls
              the preview table. Long imports used to require
              scrolling to the bottom of the table just to commit. */}
          <div className="sticky top-0 z-sticky flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/95 px-4 py-3 text-sm shadow-sm backdrop-blur">
            <div className="flex flex-wrap gap-4 text-foreground-secondary">
              <span>
                <strong>{preview.summary.total}</strong> {t('organizer.personsImport.rowsChip')}
              </span>
              <span className="text-success">
                <strong>{preview.summary.ok}</strong> {t('admin.globalPersonsImport.okChip')}
              </span>
              <span className="text-warning">
                <strong>{preview.summary.duplicate}</strong>{' '}
                {t('admin.globalPersonsImport.duplicateChip')}
              </span>
              <span className="text-danger">
                <strong>{preview.summary.invalid}</strong>{' '}
                {t('organizer.personsImport.invalidChip')}
              </span>
              <span className="text-muted">
                {t('admin.globalPersonsImport.summaryWillCreate')}{' '}
                <strong>{decisionSummary.create_new}</strong>
                {t('admin.globalPersonsImport.summaryOverwrite')}{' '}
                <strong>{decisionSummary.overwrite}</strong>
                {t('admin.globalPersonsImport.summarySkip')} <strong>{decisionSummary.skip}</strong>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={skipAllInvalid}
                className="text-xs border border-border px-2 py-1 rounded hover:bg-surface"
              >
                {t('admin.globalPersonsImport.skipAllInvalid')}
              </button>
              <button
                type="button"
                onClick={skipAllDuplicates}
                className="text-xs border border-border px-2 py-1 rounded hover:bg-surface"
              >
                {t('admin.globalPersonsImport.skipAllDuplicates')}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="text-sm text-muted hover:text-foreground-secondary disabled:opacity-50"
              >
                {t('organizer.personsImport.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={busy}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
              >
                {busy
                  ? t('organizer.personsImport.importing')
                  : t('admin.globalPersonsImport.commitButton', {
                      count: decisionSummary.create_new + decisionSummary.overwrite,
                    })}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-background border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colRow')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colAction')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colGivenName')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colFamilyName')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colDisplayName')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colClub')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colHemaId')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colEmail')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colDob')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colRoles')}</th>
                  <th className="px-3 py-2">{t('admin.globalPersonsImport.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((row) => {
                  const muted = row.action === 'skip' || row.status === 'invalid';
                  return (
                    <tr
                      key={row.index}
                      className={[
                        'border-b border-border align-top',
                        muted ? 'bg-background/60 opacity-60' : '',
                        row.status === 'invalid' ? 'bg-danger/10' : '',
                        row.status === 'duplicate' ? 'bg-warning/10' : '',
                      ].join(' ')}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-muted">#{row.index}</td>
                      <td className="px-3 py-2">
                        {row.status === 'invalid' ? (
                          <span className="text-xs text-muted italic">
                            {t('admin.globalPersonsImport.skipLower')}
                          </span>
                        ) : (
                          <select
                            value={row.action}
                            onChange={(e) =>
                              updateRow(row.index, { action: e.target.value as RowAction })
                            }
                            className="border border-border rounded px-2 py-1 text-xs"
                          >
                            <option value="skip">
                              {t('admin.globalPersonsImport.actionSkip')}
                            </option>
                            <option value="create_new">
                              {t('admin.globalPersonsImport.actionCreateNew')}
                            </option>
                            {row.duplicate && (
                              <option value="overwrite">
                                {t('admin.globalPersonsImport.actionOverwrite')}
                              </option>
                            )}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.givenName}
                          onChange={(e) => updateRowField(row.index, 'givenName', e.target.value)}
                          className="w-28 border border-border rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.familyName}
                          onChange={(e) => updateRowField(row.index, 'familyName', e.target.value)}
                          className="w-28 border border-border rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.displayName}
                          onChange={(e) => updateRowField(row.index, 'displayName', e.target.value)}
                          className="w-32 border border-border rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.clubLabel ?? ''}
                          onChange={(e) =>
                            updateRowField(row.index, 'clubLabel', e.target.value || null)
                          }
                          placeholder={t('admin.globalPersonsImport.clubPlaceholder')}
                          className="w-32 border border-border rounded px-2 py-1 text-xs mb-1"
                          disabled={row.action === 'skip'}
                        />
                        <input
                          value={row.fields.clubAbbreviation ?? ''}
                          onChange={(e) =>
                            updateRowField(row.index, 'clubAbbreviation', e.target.value || null)
                          }
                          placeholder={t('admin.globalPersonsImport.abvPlaceholder')}
                          className="w-32 border border-border rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.fields.hemaRatingsId ?? ''}
                          onChange={(e) =>
                            updateRowField(row.index, 'hemaRatingsId', e.target.value || null)
                          }
                          className="w-24 border border-border rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="email"
                          value={row.fields.email ?? ''}
                          onChange={(e) =>
                            updateRowField(row.index, 'email', e.target.value || null)
                          }
                          placeholder={t('admin.globalPersonsImport.optionalPlaceholder')}
                          className="w-40 border border-border rounded px-2 py-1 text-xs"
                          disabled={row.action === 'skip'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={dateFormat.format(row.fields.dateOfBirth ?? '')}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (!next.trim()) {
                              updateRowField(row.index, 'dateOfBirth', null);
                              return;
                            }
                            // Accept the locale format; keep the ISO
                            // fallback so the backend-projected value
                            // round-trips cleanly without an extra edit.
                            const iso =
                              dateFormat.parse(next) ??
                              (/^\d{4}-\d{2}-\d{2}$/.test(next.trim()) ? next.trim() : null);
                            updateRowField(row.index, 'dateOfBirth', iso ?? next);
                          }}
                          placeholder={dateFormat.placeholder}
                          pattern={dateFormat.htmlPattern}
                          className={`w-32 border rounded px-2 py-1 text-xs ${
                            row.fields.dateOfBirth &&
                            !/^\d{4}-\d{2}-\d{2}$/.test(row.fields.dateOfBirth)
                              ? 'border-danger'
                              : 'border-border'
                          }`}
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
                          <span className="text-danger">
                            {t('admin.globalPersonsImport.invalidLine', {
                              reasons:
                                row.reasons.join(', ') ||
                                t('admin.globalPersonsImport.reasonsUnknown'),
                            })}
                          </span>
                        )}
                        {row.status === 'duplicate' && row.duplicate && (
                          <span className="text-warning">
                            {t('admin.globalPersonsImport.duplicateOfPrefix')}{' '}
                            <strong>{row.duplicate.displayName}</strong>
                          </span>
                        )}
                        {row.status === 'ok' && <span className="text-success">OK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'done' && report && (
        <div className="max-w-2xl">
          {totalImported > 0 ? (
            <div className="text-center py-6 mb-6">
              <p className="text-4xl mb-3">✅</p>
              <h2 className="font-display font-semibold text-lg sm:text-xl mb-2">
                {t('organizer.personsImport.doneTitle')}
              </h2>
              <p className="text-sm text-muted">
                {t('admin.globalPersonsImport.doneSummary', {
                  created: report.created,
                  updated: report.updated,
                })}
              </p>
            </div>
          ) : (
            <div className="text-center py-6 mb-6 rounded-lg border border-warning/30 bg-warning/10">
              <p className="text-4xl mb-3">⚠️</p>
              <h2 className="font-display font-semibold text-lg sm:text-xl mb-2 text-warning">
                {t('admin.globalPersonsImport.nothingImportedTitle')}
              </h2>
              <p className="text-sm text-warning">
                {t('admin.globalPersonsImport.nothingImportedBody')}
              </p>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              {
                label: t('admin.globalPersonsImport.statCreated'),
                value: report.created,
                color: 'text-success bg-success/10 border-success/30',
              },
              {
                label: t('admin.globalPersonsImport.statUpdated'),
                value: report.updated,
                color: 'text-info bg-info/10 border-info/30',
              },
              {
                label: t('admin.globalPersonsImport.statSkipped'),
                value: report.skipped,
                color: 'text-foreground-secondary bg-background border-border',
              },
              {
                label: t('admin.globalPersonsImport.statFailed'),
                value: report.failed.length,
                color: 'text-danger bg-danger/10 border-danger/30',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className={`border rounded-lg p-3 text-center ${color}`}>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>

          {report.failed.length > 0 && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm mb-5">
              <p className="font-medium text-danger mb-2">
                {t('admin.globalPersonsImport.failedRows')}
              </p>
              <ul className="space-y-0.5 text-xs text-danger list-disc list-inside">
                {report.failed.map((f) => (
                  <li key={f.index}>
                    {t('organizer.personsImport.rowPrefix', { n: f.index })} {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.newClubs.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm mb-5">
              <p className="font-medium text-warning mb-1">
                {t('admin.globalPersonsImport.newClubsCreated', {
                  count: report.newClubs.length,
                })}
              </p>
              <div className="flex flex-wrap gap-1">
                {report.newClubs.map((c) => (
                  <span key={c} className="bg-warning/10 text-warning px-2 py-0.5 rounded text-xs">
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-xs text-warning mt-2">
                {t('admin.globalPersonsImport.reviewClubsPrefix')}{' '}
                <Link href="/admin/clubs" className="underline">
                  {t('admin.globalPersonsImport.clubsAdminLink')}
                </Link>
                .
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={reset}
              className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm"
            >
              {t('admin.globalPersonsImport.importAnother')}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
