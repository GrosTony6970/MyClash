import Link from 'next/link';

/**
 * Unified "← Back to …" affordance for the public event pages (event home,
 * tournament, workshops, participants, …). One bordered-pill style everywhere
 * so the back navigation reads consistently. The arrow is built in — pass an
 * arrow-free label. `className` is appended for per-page spacing (e.g. `mb-4`).
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={[
        'inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span aria-hidden="true">←</span>
      <span>{label}</span>
    </Link>
  );
}
