'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { NavIcon } from '@myclash/ui';
import type { PlatformRole } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import type { WorkspaceOption, WorkspaceOptions } from './workspace-options';

/**
 * The gold line directly under the sidebar logo, in both admin shells.
 *
 * It names the workspace you are IN — "Platform Admin workspace" or "Organiser
 * workspace" — which is what the three links it replaced never did. Those were
 * a "Workspace" nav section in the console, an unlabelled bordered block in the
 * organiser shell, and a tier badge that answered a different question
 * ("Super admin") in a third place.
 *
 * The switch icon appears only when there is somewhere else to GO. An account
 * with a single workspace gets plain text: an icon that opens a menu listing
 * the page you are already on is a promise the app can't keep.
 *
 * Mounted as the first child of each shell's shared `sidebar` node, NOT in the
 * brand block — `sidebar` is what renders in both the desktop rail and the
 * mobile drawer, and a `<button>` nested inside the brand `<Link>` would be
 * invalid markup.
 */

const LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wider text-gold';

/**
 * Moved here from SuperAdminShell when the tier badge became the workspace
 * label. Still named per tier rather than a flat "Super admin": an operator on
 * a read-only account should not be told they are a super admin — that is how
 * someone concludes the app is broken when a button 403s.
 */
function tierLabelKey(tier: PlatformRole | null): string {
  if (tier === 'super_admin') return 'admin.shell.roleLabel.superAdmin';
  if (tier === 'platform_admin') return 'admin.shell.roleLabel.platformAdmin';
  return 'admin.shell.roleLabel.platformViewer';
}

function optionKey(option: WorkspaceOption): string {
  return option.kind === 'platform' ? 'platform' : `org:${option.slug}`;
}

export function WorkspaceSwitcher({
  options,
  current,
  fallbackLabelKey,
  onNavigate,
}: WorkspaceOptions & {
  /**
   * Label shown when `current` is null — either `/me` hasn't resolved yet, or
   * this is platform staff inside an org they hold no membership in. Each shell
   * knows which workspace it IS, so it can always name it.
   */
  fallbackLabelKey: string;
  /** Closes the mobile drawer, like every other link in the sidebar. */
  onNavigate: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Escape closes the popover.
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Outside-click closes the popover.
  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const label = current
    ? t(
        current.kind === 'platform'
          ? 'admin.workspaceSwitcher.platform'
          : 'admin.workspaceSwitcher.organiser',
      )
    : t(fallbackLabelKey);

  // Gate on "is there anywhere ELSE to go", not on options.length. A platform
  // admin with no org membership browsing /org/{someone-else} has exactly one
  // option and a null current — they still need the way back to the console,
  // and a length check would have stranded them there.
  const hasElsewhere = options.some((option) => option !== current);

  if (!hasElsewhere) {
    return (
      <div className="border-b border-border pb-5">
        <p className={`px-3 ${LABEL_CLASS}`}>{label}</p>
      </div>
    );
  }

  return (
    <div className="border-b border-border pb-5">
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('admin.workspaceSwitcher.switchLabel')}
          className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-gold transition-colors hover:bg-foreground/10"
        >
          <span className={`min-w-0 truncate ${LABEL_CLASS}`}>{label}</span>
          <NavIcon name="switchWorkspace" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-xl"
          >
            {options.map((option) => {
              const isCurrent = option === current;
              return (
                <Link
                  key={optionKey(option)}
                  role="menuitem"
                  href={option.href}
                  onClick={() => {
                    setOpen(false);
                    onNavigate();
                  }}
                  className={[
                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors',
                    isCurrent
                      ? 'bg-accent/70 text-accent-foreground'
                      : 'text-foreground hover:bg-foreground/10',
                  ].join(' ')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {option.kind === 'platform'
                        ? t('admin.workspaceSwitcher.platform')
                        : option.name}
                    </span>
                    <span
                      className={[
                        'block truncate text-[0.7rem]',
                        isCurrent ? 'opacity-80' : 'text-muted',
                      ].join(' ')}
                    >
                      {option.kind === 'platform'
                        ? t(tierLabelKey(option.tier))
                        : t('admin.workspaceSwitcher.organiser')}
                    </span>
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider">
                      {t('admin.workspaceSwitcher.current')}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
