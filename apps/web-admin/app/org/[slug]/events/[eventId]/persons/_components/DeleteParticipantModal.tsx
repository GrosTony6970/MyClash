'use client';

/**
 * DeleteParticipantModal — pre-flight + force-delete UX for the three
 * delete surfaces on the persons page (per-row Delete, per-tournament
 * Unassign, Bulk Delete).
 *
 * On open it fans out `GET /events/:eventId/persons/:personId/assignments`
 * (with an optional `tournamentId` filter) per selected person so the
 * operator can see exactly where the participant is plumbed in before
 * confirming. Blocking matches — running / paused / completed / forfeit
 * / disqualified — render red and exempt the row from the force-delete
 * batch (skip-blocked semantics).
 *
 * On confirm:
 *   - tournamentId present  → POST /registrations/:id/force-delete per
 *                             reg in scope (the per-tournament path).
 *   - tournamentId absent   → DELETE /persons/:id?force=true&eventId=…
 *                             (the per-row / bulk paths).
 *
 * Backend rejects with 409 if a blocking match snuck in between probe
 * and confirm; the error message bubbles into the toast caller.
 */

import { useEffect, useMemo, useState } from 'react';

interface BlockingMatch {
  matchId: string;
  label: string;
  status: string;
  reason: 'fighter' | 'referee';
}

interface AssignmentEntry {
  poolId?: string;
  poolName?: string;
  slotId?: string;
  round?: number;
  position?: number;
  matchId?: string;
  label?: string;
  status?: string;
  role?: string;
  tournamentId: string;
  tournamentName: string;
}

interface AssignmentReport {
  personId: string;
  pools: AssignmentEntry[];
  bracketSlots: AssignmentEntry[];
  matchesAsFighter: AssignmentEntry[];
  matchesAsReferee: AssignmentEntry[];
  blockingMatches: BlockingMatch[];
  hasBlockingMatch: boolean;
}

export interface PersonSummary {
  id: string;
  displayName: string;
}

export interface ScopedRegistration {
  registrationId: string;
  personId: string;
  tournamentId: string;
}

/** A row that didn't get deleted, with the reason the operator needs
 *  to see. Reasons come from two places:
 *  1. Client-side: rows pre-flagged as having a blocking match by the
 *     assignments probe.
 *  2. Server-side: the BE's response body `message` when the
 *     force-delete POST (or whole-event DELETE) returns non-2xx. */
export interface SkippedRow {
  name: string;
  reason: string;
}

interface Props {
  apiUrl: string;
  eventId: string;
  persons: PersonSummary[];
  /** Optional. When set, every probe and force-delete is scoped to this
   *  tournament (per-tournament Unassign). When null, the modal operates
   *  on the whole event (per-row Delete / Bulk Delete). */
  tournamentId: string | null;
  /** Used for the per-tournament path to find the registration id for
   *  each personId in scope. */
  registrationsInScope: ScopedRegistration[];
  onClose: () => void;
  onDeleted: (summary: { succeeded: string[]; skipped: SkippedRow[] }) => void;
}

interface Row {
  personId: string;
  displayName: string;
  loading: boolean;
  error: string | null;
  report: AssignmentReport | null;
}

export function DeleteParticipantModal({
  apiUrl,
  eventId,
  persons,
  tournamentId,
  registrationsInScope,
  onClose,
  onDeleted,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    persons.map((p) => ({
      personId: p.id,
      displayName: p.displayName,
      loading: true,
      error: null,
      report: null,
    })),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      persons.map(async (p) => {
        const query = tournamentId ? `?tournamentId=${tournamentId}` : '';
        const url = `${apiUrl}/api/v1/events/${eventId}/persons/${p.id}/assignments${query}`;
        try {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) throw new Error(`Probe failed (${res.status})`);
          const report = (await res.json()) as AssignmentReport;
          return { personId: p.id, report, error: null };
        } catch (err) {
          return {
            personId: p.id,
            report: null,
            error: err instanceof Error ? err.message : 'Probe failed',
          };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setRows((prev) =>
        prev.map((r) => {
          const result = results.find((x) => x.personId === r.personId);
          if (!result) return r;
          return { ...r, loading: false, report: result.report, error: result.error };
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId, persons, tournamentId]);

  const counts = useMemo(() => {
    const ready = rows.filter((r) => !r.loading && r.report);
    const blocked = ready.filter((r) => r.report!.hasBlockingMatch);
    const clean = ready.filter((r) => !r.report!.hasBlockingMatch);
    return {
      total: rows.length,
      blocked: blocked.length,
      clean: clean.length,
      stillLoading: rows.filter((r) => r.loading).length,
      cleanRows: clean,
      blockedRows: blocked,
    };
  }, [rows]);

  async function confirm() {
    if (counts.clean === 0) return;
    setBusy(true);
    const succeeded: string[] = [];
    // Blocked rows skipped pre-flight because the assignments probe
    // already found a running/completed/forfeit match for them.
    const skipped: SkippedRow[] = counts.blockedRows.map((r) => ({
      name: r.displayName,
      reason: 'Has an active or completed match',
    }));
    for (const row of counts.cleanRows) {
      try {
        if (tournamentId) {
          // Per-tournament path: force-delete the matching registration.
          const regs = registrationsInScope.filter(
            (r) => r.personId === row.personId && r.tournamentId === tournamentId,
          );
          for (const reg of regs) {
            const res = await fetch(
              `${apiUrl}/api/v1/registrations/${reg.registrationId}/force-delete`,
              { method: 'POST', credentials: 'include' },
            );
            if (!res.ok) throw new Error(await extractBackendReason(res));
          }
        } else {
          const res = await fetch(
            `${apiUrl}/api/v1/persons/${row.personId}?force=true&eventId=${eventId}`,
            { method: 'DELETE', credentials: 'include' },
          );
          if (!res.ok) throw new Error(await extractBackendReason(res));
        }
        succeeded.push(row.displayName);
      } catch (err) {
        skipped.push({
          name: row.displayName,
          reason:
            err instanceof Error && err.message ? err.message : 'Server rejected the deletion',
        });
      }
    }
    setBusy(false);
    onDeleted({ succeeded, skipped });
  }

  const buttonLabel =
    counts.total === 1
      ? 'Force delete and remove from everywhere'
      : `Force delete ${counts.clean} of ${counts.total}`;
  const headerLabel = tournamentId
    ? 'Remove participants from this tournament'
    : counts.total === 1
      ? 'Delete participant'
      : `Delete ${counts.total} participants`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg bg-surface p-6 shadow-2xl">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {headerLabel}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {tournamentId
            ? 'Reviewing pool / bracket / match assignments inside the selected tournament. Started or completed matches block removal — those participants stay.'
            : 'Reviewing every place these participants are plumbed in across the event. Started or completed matches block removal — those participants stay.'}
        </p>

        <div className="mt-5 space-y-3">
          {rows.map((row) => (
            <PersonAssignmentCard key={row.personId} row={row} />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-muted">
            {counts.stillLoading > 0
              ? `Loading ${counts.stillLoading}…`
              : counts.blocked > 0
                ? `${counts.blocked} blocked, ${counts.clean} will be removed.`
                : `${counts.clean} will be removed.`}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || counts.stillLoading > 0 || counts.clean === 0}
              className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-danger-foreground hover:bg-danger-hover disabled:opacity-50"
            >
              {busy ? 'Working…' : buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Pull the BE's human-readable error reason out of a non-ok response.
 * MyClash's ApiExceptionFilter serialises NestJS exceptions to
 * `{ statusCode, code, message, details, … }`, so reading `message`
 * surfaces the original `throw new BadRequestException('…')` /
 * `ConflictException('…')` string. Falls back to `HTTP <status>` if
 * the body isn't JSON or the message is missing.
 */
async function extractBackendReason(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message?.trim() || `HTTP ${res.status}`;
}

function PersonAssignmentCard({ row }: { row: Row }) {
  if (row.loading) {
    return (
      <div className="rounded-md border border-border bg-background p-3 text-sm text-muted">
        Loading {row.displayName}…
      </div>
    );
  }
  if (row.error || !row.report) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
        {row.displayName}: {row.error ?? 'No data.'}
      </div>
    );
  }
  const r = row.report;
  const blocked = r.hasBlockingMatch;
  return (
    <div
      className={[
        'rounded-md border p-3',
        blocked ? 'border-danger/30 bg-danger/10' : 'border-border bg-surface',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{row.displayName}</p>
        {blocked && (
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
            Blocked
          </span>
        )}
      </div>

      {blocked && r.blockingMatches.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-danger">
          {r.blockingMatches.map((m) => (
            <li key={`${m.matchId}-${m.reason}`}>
              {m.reason === 'fighter' ? 'Fighting' : 'Refereeing'} match{' '}
              <span className="font-mono">{m.label || m.matchId}</span> ({m.status})
            </li>
          ))}
        </ul>
      )}

      {(r.pools.length > 0 ||
        r.bracketSlots.length > 0 ||
        r.matchesAsFighter.length > 0 ||
        r.matchesAsReferee.length > 0) && (
        <ul className="mt-2 list-disc pl-5 text-xs text-foreground-secondary">
          {r.pools.map((p) => (
            <li key={`pool-${p.poolId}`}>
              {p.poolName} (pool) — <span className="italic">{p.tournamentName}</span>
            </li>
          ))}
          {r.bracketSlots.map((b) => (
            <li key={`slot-${b.slotId}`}>
              Bracket slot R{b.round}P{b.position} —{' '}
              <span className="italic">{b.tournamentName}</span>
            </li>
          ))}
          {r.matchesAsFighter
            .filter((m) => !r.blockingMatches.some((bm) => bm.matchId === m.matchId))
            .map((m) => (
              <li key={`f-${m.matchId}`}>
                Fighting match <span className="font-mono">{m.label || m.matchId}</span> ({m.status}
                ) — <span className="italic">{m.tournamentName}</span>
              </li>
            ))}
          {r.matchesAsReferee
            .filter((m) => !r.blockingMatches.some((bm) => bm.matchId === m.matchId))
            .map((m) => (
              <li key={`r-${m.matchId}`}>
                Refereeing match <span className="font-mono">{m.label || m.matchId}</span> (
                {m.status}) — <span className="italic">{m.tournamentName}</span>
              </li>
            ))}
        </ul>
      )}

      {!blocked &&
        r.pools.length === 0 &&
        r.bracketSlots.length === 0 &&
        r.matchesAsFighter.length === 0 &&
        r.matchesAsReferee.length === 0 && (
          <p className="mt-1 text-xs text-muted italic">No active assignments.</p>
        )}
    </div>
  );
}
