'use client';

import Link from 'next/link';

/**
 * CreateRulesetCta — the polished red "+" CTA used at the top of every
 * ruleset catalogue. Single class string lifted from the League tab's
 * pre-unification version (the only one with focus-visible ring +
 * shadow + transition). Scoring + Penalty migrate to it.
 */
export function CreateRulesetCta({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
    >
      + {label}
    </Link>
  );
}
