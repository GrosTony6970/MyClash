'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents } from './hooks';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={['h-4 w-4 transition-transform', open ? '' : '-rotate-90'].join(' ')}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SubLink({
  href,
  active,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={[
        'block rounded-md px-3 py-1.5 text-sm transition-colors',
        active ? 'bg-foreground/15 text-foreground' : 'text-muted hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

/**
 * Desktop sidebar "My Events" — one separated block per event (colour dot +
 * name + collapse chevron + divider between events), links indented under a
 * left rail. Renders nothing when the user has no events.
 */
export function MyEventsNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const { events } = useMyEvents();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  if (!events || events.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted"
      >
        {t('publicApp.me.nav.myEvents')}
        <Chevron open={open} />
      </button>
      {open && (
        <div className="mt-1 space-y-2.5">
          {events.map((e, i) => {
            const base = `/me/events/${e.event.slug}`;
            return (
              <div key={e.event.id} className={i > 0 ? 'border-t border-border pt-2.5' : ''}>
                <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-foreground/80">
                  <span
                    className={[
                      'h-2 w-2 shrink-0 rounded-full',
                      i % 2 === 0 ? 'bg-info' : 'bg-gold',
                    ].join(' ')}
                  />
                  <span className="truncate">{e.event.name}</span>
                </div>
                <div className="ml-4 border-l border-border pl-2">
                  <SubLink href={base} active={pathname === base} onNavigate={onNavigate}>
                    {t('publicApp.me.hub.tabOverview')}
                  </SubLink>
                  <SubLink
                    href={`${base}/schedule`}
                    active={pathname === `${base}/schedule`}
                    onNavigate={onNavigate}
                  >
                    {t('publicApp.me.hub.tabSchedule')}
                  </SubLink>
                  <SubLink
                    href={`${base}/workshops`}
                    active={pathname === `${base}/workshops`}
                    onNavigate={onNavigate}
                  >
                    {t('publicApp.me.hub.tabWorkshops')}
                  </SubLink>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
