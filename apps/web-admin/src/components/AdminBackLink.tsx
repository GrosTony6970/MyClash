import Link from 'next/link';
import type { ReactNode } from 'react';

interface AdminBackLinkProps {
  children: ReactNode;
  href?: string;
}

export function AdminBackLink({ children, href = '/admin' }: AdminBackLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-500/50 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
    >
      {children}
    </Link>
  );
}
