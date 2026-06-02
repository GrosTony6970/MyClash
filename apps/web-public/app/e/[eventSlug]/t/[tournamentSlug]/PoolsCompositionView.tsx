/**
 * Per-pool composition view for the public tournament page.
 *
 * Each pool renders as a card:
 *   - header: pool name + fighter count + accent stripe (tournament color)
 *   - body: members (seed · fighter · club)
 *   - footer: referee slots (role · name · status)
 *
 * Server component — fed by the SSR fetch on the tournament page.
 */

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
}

interface Pool {
  id: string;
  name: string;
  members: PoolMember[];
  referees: PoolReferee[];
}

interface Props {
  pools: Pool[];
  accentColor: string;
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

export function PoolsCompositionView({ pools, accentColor }: Props) {
  if (pools.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-stone-100 p-6 text-center text-sm text-slate-500">
        Pool rosters will be published before the event starts.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {pools.map((pool) => (
        <article
          key={pool.id}
          className="relative overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm"
        >
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 h-full w-1"
            style={{ backgroundColor: accentColor }}
          />
          <header className="flex items-baseline justify-between gap-3 border-b border-stone-100 px-4 py-3 pl-5">
            <h3 className="font-display text-lg font-semibold text-slate-900">{pool.name}</h3>
            <span className="text-xs uppercase tracking-wider text-slate-500">
              {pool.members.length} fighters
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
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-100 font-mono text-xs text-slate-600">
                        {m.seed ?? '—'}
                      </span>
                      <span className="truncate font-medium text-slate-900">{m.fighterName}</span>
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
                      <span className="truncate text-slate-700">{r.displayName}</span>
                    </span>
                    <span className="text-xs uppercase tracking-wide text-slate-500">
                      {refereeRoleLabel(r.role)}
                    </span>
                  </li>
                ))}
              </ul>
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}
