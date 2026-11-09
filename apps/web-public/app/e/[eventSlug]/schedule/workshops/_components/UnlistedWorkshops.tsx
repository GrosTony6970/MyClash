import Link from 'next/link';
import { accentClassFor } from '@myclash/ui';
import { CANCELLED_TEXT, CancelledBadge } from '@/components/workshops/session-cancelled';
import type { UnlistedWorkshop } from '../_lib/workshop-grid-data';

/**
 * Workshops the grid can't place — either untimed, or timed into a room that
 * isn't one of the grid's columns. The old agenda dropped both on the floor, so
 * a published-but-unscheduled workshop was invisible on the whole public site.
 *
 * Server component: static rows, no interactivity beyond the link.
 */
export function UnlistedWorkshops({
  heading,
  workshops,
  t,
}: {
  heading: string;
  workshops: UnlistedWorkshop[];
  /** The page's translator: a cancelled session is marked (ruling 526). */
  t: (key: string) => string;
}) {
  if (workshops.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{heading}</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {workshops.map((w) => {
          const subtitle =
            w.instructorNames.join(', ') || [w.category, w.level].filter(Boolean).join(' · ');
          return (
            <li key={w.key}>
              <Link
                href={w.href}
                className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-surface p-3 pl-4 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-0 h-full w-1 ${accentClassFor(w.color)}`}
                />
                <div className={`min-w-0 flex-1 ${w.cancelled ? CANCELLED_TEXT : ''}`}>
                  <p
                    className={`truncate font-display text-sm font-semibold ${w.cancelled ? '' : 'text-foreground'}`}
                  >
                    {w.title}
                  </p>
                  {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
                </div>
                {w.cancelled && <CancelledBadge t={t} />}
                <span className="shrink-0 font-semibold text-accent group-hover:text-accent-hover">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
