'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

type IconProps = { className?: string };

function HomeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function CalIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M3 7h18v13H3z" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  );
}
function UserIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
function DotsIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

const ITEMS: Array<{
  key: 'home' | 'events' | 'profile' | 'more';
  href: string;
  icon: ComponentType<IconProps>;
  match: (p: string) => boolean;
}> = [
  { key: 'home', href: '/me', icon: HomeIcon, match: (p) => p === '/me' },
  { key: 'events', href: '/me/events', icon: CalIcon, match: (p) => p.startsWith('/me/events') },
  {
    key: 'profile',
    href: '/me/fighter',
    icon: UserIcon,
    match: (p) =>
      p.startsWith('/me/fighter') || p.startsWith('/me/referee') || p.startsWith('/me/profile'),
  },
  {
    key: 'more',
    href: '/me/notifications',
    icon: DotsIcon,
    match: (p) => p.startsWith('/me/notifications') || p.startsWith('/me/security'),
  },
];

/**
 * Phone-only bottom tab bar (primary nav). Hidden at lg+ where the left sidebar
 * takes over. Tokenized; 46px targets; safe-area inset.
 */
export function BottomNav() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('publicApp.personalShell.navigationLabel')}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex min-h-[46px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10.5px] font-semibold [touch-action:manipulation]',
              active ? 'text-accent' : 'text-muted',
            ].join(' ')}
          >
            <Icon className="h-5 w-5" />
            {t(`publicApp.me.nav.${item.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
