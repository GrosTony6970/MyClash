'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * Referee assignment UI — T-908
 * Route: /org/[slug]/events/[eventId]/referee-assignments
 *
 * AC:
 *   ✓ Visual schedule grid: pools × roles
 *   ✓ Auto-assign button + dry-run preview
 *   ✓ Manual override (click to reassign)
 *   ✓ Missing-role report
 *   ✓ Lock assignments
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

type Role = 'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table';

const ROLES: { id: Role; label: string }[] = [
  { id: 'arbitre_declarant', label: 'Déclarant' },
  { id: 'arbitre_assesseur', label: 'Assesseur' },
  { id: 'arbitre_table', label: 'Table' },
];

interface Assignment {
  poolId: string;
  poolName: string;
  role: Role;
  personId: string;
  personName: string;
  autoAssigned: boolean;
}

interface MissingAssignment {
  poolId: string;
  poolName: string;
  role: Role;
  rejectionReasons: string[];
}

interface Warning {
  type: string;
  personName: string;
  poolName: string;
  role: Role;
  detail: string;
}

interface AssignmentResult {
  assignments: Assignment[];
  missing: MissingAssignment[];
  warnings: Warning[];
  persisted?: number;
}

interface Candidate {
  personId: string;
  personName: string;
}

export default function RefereeAssignmentsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();

  const [result, setResult] = useState<AssignmentResult | null>(null);
  const [pools, setPools] = useState<Array<{ id: string; name: string }>>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [locking, setLocking] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(true);

  // Override modal
  const [overrideCell, setOverrideCell] = useState<{
    poolId: string;
    poolName: string;
    role: Role;
  } | null>(null);

  // ── Fetch pools + candidates ────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/pools`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/referee-qualifications`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([poolsRes, qualsRes]) => {
        setLoading(false);
        if (poolsRes.ok) setPools((await poolsRes.json()) as Array<{ id: string; name: string }>);
        if (qualsRes.ok) {
          const quals = (await qualsRes.json()) as Array<{
            personId: string;
            persons?: { given_name: string; family_name: string };
          }>;
          const byPerson = new Map<string, string>();
          for (const q of quals) {
            if (!byPerson.has(q.personId) && q.persons) {
              byPerson.set(q.personId, `${q.persons.given_name} ${q.persons.family_name}`);
            }
          }
          setCandidates(
            Array.from(byPerson.entries()).map(([personId, personName]) => ({
              personId,
              personName,
            })),
          );
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [eventId, apiUrl]);

  // ── Auto-assign ─────────────────────────────────────────────────────────────

  async function autoAssign(dryRun: boolean) {
    setRunning(true);
    setError(null);
    setIsDryRun(dryRun);

    try {
      const res = await fetch(
        `${apiUrl}/api/v1/events/${eventId}/auto-assign-referees?dryRun=${dryRun}`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const b = (await res.json()) as { message?: string };
        throw new Error(b.message ?? 'Auto-assign failed');
      }
      setResult((await res.json()) as AssignmentResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setRunning(false);
    }
  }

  // ── Manual override ─────────────────────────────────────────────────────────

  async function handleOverride(poolId: string, role: Role, personId: string, personName: string) {
    if (!result) return;
    setOverrideCell(null);

    // Optimistic update
    const updated = result.assignments.filter((a) => !(a.poolId === poolId && a.role === role));
    updated.push({
      poolId,
      poolName: pools.find((p) => p.id === poolId)?.name ?? poolId,
      role,
      personId,
      personName,
      autoAssigned: false,
    });
    setResult({ ...result, assignments: updated });

    // Persist
    await fetch(`${apiUrl}/api/v1/referee-assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ eventId, poolId, role, personId }),
    });
  }

  // ── Lock ────────────────────────────────────────────────────────────────────

  async function lockAssignments() {
    setLocking(true);
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/lock-referee-assignments`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) setLocked(true);
    setLocking(false);
  }

  // ── Build grid ──────────────────────────────────────────────────────────────

  function getAssignment(poolId: string, role: Role): Assignment | undefined {
    return result?.assignments.find((a) => a.poolId === poolId && a.role === role);
  }

  function isMissing(poolId: string, role: Role): boolean {
    return result?.missing.some((m) => m.poolId === poolId && m.role === role) ?? false;
  }

  function getWarnings(poolId: string, role: Role): Warning[] {
    return (
      result?.warnings.filter(
        (w) => w.poolName === pools.find((p) => p.id === poolId)?.name && w.role === role,
      ) ?? []
    );
  }

  return (
    <main className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href={`/org/${slug}`} className="hover:text-gray-700">
              {slug}
            </Link>
            <span>/</span>
            <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-gray-700">
              Event
            </Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Referee assignments</span>
          </div>
          <h1 className="text-2xl font-bold">Referee assignments</h1>
        </div>
        <Link
          href={`/org/${slug}/events/${eventId}/ai-assistant?type=referee_assignments`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {t('organizer.aiAssistant.suggest')}
        </Link>
        <Link
          href={`/org/${slug}/events/${eventId}/referees`}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          ← Qualifications
        </Link>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => void autoAssign(true)}
          disabled={running}
          className="border border-gray-300 hover:border-gray-400 text-gray-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {running && isDryRun ? 'Running…' : 'Preview auto-assign'}
        </button>
        <button
          onClick={() => void autoAssign(false)}
          disabled={running}
          className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
        >
          {running && !isDryRun ? 'Assigning…' : 'Auto-assign & save'}
        </button>
        {result && !isDryRun && !locked && (
          <button
            onClick={() => void lockAssignments()}
            disabled={locking}
            className="bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
          >
            {locking ? 'Locking…' : 'Lock assignments'}
          </button>
        )}
        {locked && <span className="text-sm text-green-600 font-medium">✓ Assignments locked</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      {result && (
        <div className="flex gap-4 mb-4 text-sm">
          <span className="text-green-700 font-medium">✓ {result.assignments.length} assigned</span>
          {result.missing.length > 0 && (
            <span className="text-red-600 font-medium">✗ {result.missing.length} missing</span>
          )}
          {result.warnings.length > 0 && (
            <span className="text-orange-600 font-medium">⚠ {result.warnings.length} warnings</span>
          )}
          {isDryRun && <span className="text-gray-400 italic">Preview only — not saved</span>}
        </div>
      )}

      {/* Assignment grid */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : pools.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">No pools found. Generate pools first.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4 font-medium">Pool</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="py-2 px-3 font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => (
                <tr key={pool.id} className="border-b border-gray-100">
                  <td className="py-3 pr-4 font-medium text-gray-900">{pool.name}</td>
                  {ROLES.map((role) => {
                    const assignment = getAssignment(pool.id, role.id);
                    const missing = isMissing(pool.id, role.id);
                    const warnings = getWarnings(pool.id, role.id);

                    return (
                      <td key={role.id} className="py-3 px-3">
                        <div
                          className={[
                            'border rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors',
                            assignment
                              ? warnings.length > 0
                                ? 'border-orange-300 bg-orange-50 hover:border-orange-400'
                                : assignment.autoAssigned
                                  ? 'border-blue-200 bg-blue-50 hover:border-blue-300'
                                  : 'border-green-200 bg-green-50 hover:border-green-300'
                              : missing
                                ? 'border-red-300 bg-red-50'
                                : 'border-dashed border-gray-300 hover:border-gray-400',
                          ].join(' ')}
                          onClick={() =>
                            setOverrideCell({ poolId: pool.id, poolName: pool.name, role: role.id })
                          }
                          title={warnings.map((w) => w.detail).join('; ')}
                        >
                          {assignment ? (
                            <>
                              <p className="font-medium text-gray-900 truncate">
                                {assignment.personName}
                              </p>
                              {warnings.length > 0 && (
                                <p className="text-orange-600 mt-0.5">
                                  ⚠ {warnings[0]!.type.replace('_', ' ')}
                                </p>
                              )}
                              {!assignment.autoAssigned && (
                                <p className="text-green-600 mt-0.5">Manual</p>
                              )}
                            </>
                          ) : missing ? (
                            <p className="text-red-500 font-medium">Missing</p>
                          ) : (
                            <p className="text-gray-400">Click to assign</p>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Missing report */}
      {result && result.missing.length > 0 && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-bold text-red-700 mb-2">Missing assignments</p>
          <ul className="text-xs text-red-600 space-y-1">
            {result.missing.map((m, i) => (
              <li key={i}>
                <strong>{m.poolName}</strong> — {m.role.replace(/_/g, ' ')}:{' '}
                {m.rejectionReasons.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Override modal */}
      {overrideCell && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold mb-1">Assign referee</h2>
            <p className="text-sm text-gray-500 mb-4">
              {overrideCell.poolName} — {overrideCell.role.replace(/_/g, ' ')}
            </p>
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
              {candidates.map((c) => (
                <button
                  key={c.personId}
                  onClick={() =>
                    void handleOverride(
                      overrideCell.poolId,
                      overrideCell.role,
                      c.personId,
                      c.personName,
                    )
                  }
                  className="text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-400 text-sm transition-colors"
                >
                  {c.personName}
                </button>
              ))}
            </div>
            <button
              onClick={() => setOverrideCell(null)}
              className="mt-4 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
