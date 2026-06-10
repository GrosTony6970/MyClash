/**
 * Per-pool composition view for the public tournament page.
 *
 * Pools are grouped into start-time SECTIONS (pools sharing a start time sit
 * under one "DAY · TIME" header; unscheduled pools fall under a trailing
 * "Not scheduled" section). Each pool renders as a clickable card:
 *   - header: pool name + piste (lice) badge + fighter count + accent stripe
 *   - body: members (seed · fighter · club)
 *   - footer: referee slots (role · name · status), tinted by skill color
 * Clicking a card deep-links to the Pool Matches tab focused on that pool
 * (`#poolmatches/<poolId>`).
 *
 * Server component — fed by the SSR fetch on the tournament page.
 */

import { SkillBadge, tintTextClassFor } from '@myclash/ui';
import { groupPoolsByStart } from './pool-sections';

export interface PoolMember {
  registrationId: string;
  fighterName: string;
  clubName: string | null;
  clubAbbreviation: string | null;
  seed: number | null;
}

export interface PoolReferee {
  role: string | null;
  displayName: string;
  status: string;
  /**
   * Color token of the role's referee_skill (e.g. 'red', 'amber',
   * 'slate'). Drives the SkillBadge tint on the public footer. The
   * backend resolves this from referee_skills.color and defaults to
   * 'slate' when no skill row is found.
   */
  skillColor: string;
}

interface Pool {
  id: string;
  name: string;
  members: PoolMember[];
  referees: PoolReferee[];
  /** Piste (lice) + start time, derived from the pool's matches. */
  liceName: string | null;
  liceColorHex: string | null;
  startAt: string | null;
}

interface Props {
  pools: Pool[];
  /** Hex string used for the legacy vertical stripe on each card. */
  accentColor: string;
  /**
   * Tournament's brand color token (e.g. 'red', 'blue'). Drives the
   * pool name text colour via tintTextClassFor. Null falls back to
   * the existing slate-900 title.
   */
  colorToken?: string | null;
}

function refereeRoleLabel(role: string | null): string {
  if (!role) return 'Referee';
  // The role column stores referee_skills.id strings like
  // 'arbitre_declarant' / 'arbitre_assesseur' / 'arbitre_table'. We
  // surface a humanised label but don't translate — the FR-named
  // skill ids are deliberately language-neutral on the public view.
  const map: Record<string, string> = {
    arbitre_declarant: 'Déclarant',
    arbitre_assesseur: 'Assesseur',
    arbitre_table: 'Table',
  };
  return map[role] ?? role;
}

function statusDot(status: string): string {
  if (status === 'confirmed') return 'bg-emerald-500';
  if (status === 'pending') return 'bg-amber-500';
  return 'bg-slate-400';
}

function statusLabel(status: string): string {
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'pending') return 'Pending';
  return status;
}

// Day + time for the section header. fr-FR to match the public site's
// other schedule surfaces (my-schedule) — 24h times, French weekday/month.
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function PoolsCompositionView({ pools, accentColor, colorToken }: Props) {
  const titleClass = colorToken ? tintTextClassFor(colorToken) : 'text-slate-900';

  if (pools.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
        Pool rosters will be published before the event starts.
      </p>
    );
  }

  const sections = groupPoolsByStart(pools);

  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <section key={section.startAt ?? 'unscheduled'} className="flex flex-col gap-4">
          <header className="flex items-center gap-3">
            <h3
              className={`font-display text-sm font-semibold uppercase tracking-wider ${titleClass}`}
            >
              {section.startAt
                ? `${formatDay(section.startAt)} · ${formatTime(section.startAt)}`
                : 'Not scheduled'}
            </h3>
            <span aria-hidden="true" className="h-px flex-1 bg-stone-200" />
          </header>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {section.pools.map((pool) => (
              <a
                key={pool.id}
                href={`#poolmatches/${pool.id}`}
                aria-label={`${pool.name} — view pool matches`}
                className="relative block overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-shadow hover:border-stone-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ backgroundColor: accentColor }}
                />
                <header className="flex items-baseline justify-between gap-3 border-b border-stone-100 px-4 py-3 pl-5">
                  <h3 className={`font-display text-lg font-semibold ${titleClass}`}>
                    {pool.name}
                  </h3>
                  <span className="flex items-center gap-3">
                    {pool.liceName && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                        {pool.liceColorHex && (
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: pool.liceColorHex }}
                          />
                        )}
                        {pool.liceName}
                      </span>
                    )}
                    <span className="whitespace-nowrap text-xs uppercase tracking-wider text-slate-500">
                      {pool.members.length} fighters
                    </span>
                  </span>
                </header>

                <div className="px-4 py-3 pl-5">
                  {pool.members.length === 0 ? (
                    <p className="text-sm italic text-slate-500">No members assigned yet.</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-stone-100">
                      {pool.members.map((m) => (
                        <li
                          key={m.registrationId}
                          className="flex items-center justify-between gap-3 py-1.5 text-sm"
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <span
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-100 font-mono text-xs text-slate-600"
                              aria-label={m.seed !== null ? `Seed ${m.seed}` : 'Unseeded'}
                            >
                              {m.seed ?? '—'}
                            </span>
                            <span className="truncate font-medium text-slate-900">
                              {m.fighterName}
                            </span>
                          </span>
                          {(m.clubAbbreviation ?? m.clubName) && (
                            <span className="truncate text-xs text-slate-500">
                              {m.clubAbbreviation ?? m.clubName}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {pool.referees.length > 0 && (
                  <footer className="border-t border-stone-100 bg-stone-50/60 px-4 py-3 pl-5">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Referees
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {pool.referees.map((r, idx) => (
                        <li
                          key={`${pool.id}-ref-${idx}`}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              aria-hidden="true"
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(r.status)}`}
                            />
                            <span className="sr-only">{statusLabel(r.status)}.</span>
                            <span className="truncate text-slate-700">{r.displayName}</span>
                          </span>
                          <SkillBadge color={r.skillColor} label={refereeRoleLabel(r.role)} />
                        </li>
                      ))}
                    </ul>
                  </footer>
                )}
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
