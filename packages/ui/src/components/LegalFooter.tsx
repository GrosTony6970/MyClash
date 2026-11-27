import * as React from 'react';

export interface LegalFooterLink {
  label: string;
  href: string;
}

export interface LegalFooterProps {
  /** Terms, privacy policy, and anything else the app wants to surface. */
  links: readonly LegalFooterLink[];
  /** Line after the links, e.g. "© 2026 MyClash — AGPL-3.0". */
  note?: string;
  /** Drawn above the links, e.g. the public app's `InstallAppButton`. Owns its own margin. */
  action?: React.ReactNode;
  /**
   * `page`: one slim centred line at the end of a page that has no sidebar.
   * `sidebar`: small left-aligned lines at the foot of a shell's sidebar, under
   * Log out — the shell's pages then render no page footer at all.
   */
  variant?: 'page' | 'sidebar';
  className?: string;
}

const VARIANT_CLASS: Record<NonNullable<LegalFooterProps['variant']>, string> = {
  page: 'border-t border-border px-4 py-2 text-center text-xs text-muted',
  sidebar: 'px-3 text-left text-[0.7rem] text-muted',
};

const LIST_CLASS: Record<NonNullable<LegalFooterProps['variant']>, string> = {
  page: 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1',
  sidebar: 'flex flex-wrap items-center gap-x-3 gap-y-1',
};

/**
 * The strip that makes the terms and the privacy policy reachable from inside
 * the product.
 *
 * Before this existed there was no route in any app that named either document
 * — they were published on the marketing site and linked from nowhere else, so
 * a competitor who arrived on an event page had no way to reach them at all.
 *
 * Two layouts, one component. A page footer used to be two lines and ~110px
 * tall, and on a page with a sticky sidebar it appeared only once the shell
 * scrolled away — a sudden band. Shell pages now carry the links in the
 * sidebar, and the page footer is one line.
 *
 * Takes labels and hrefs as props rather than translating anything itself:
 * `@myclash/ui` has no i18n dependency, and the URLs are per-app (they point at
 * the marketing origin, which each app resolves through its own
 * `legal-url.ts`). Rendered outside the main landmark, so a screen reader's
 * document outline is unaffected.
 */
export const LegalFooter = ({
  links,
  note,
  action,
  variant = 'page',
  className = '',
}: LegalFooterProps) => (
  <footer className={[VARIANT_CLASS[variant], className].join(' ')}>
    {action}
    <ul className={LIST_CLASS[variant]}>
      {links.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            className="underline decoration-dotted underline-offset-2 hover:text-foreground-secondary"
          >
            {link.label}
          </a>
        </li>
      ))}
      {note && variant === 'page' ? <li>{note}</li> : null}
    </ul>
    {note && variant === 'sidebar' ? <p className="mt-1">{note}</p> : null}
  </footer>
);
