import * as React from 'react';

export interface LegalFooterLink {
  label: string;
  href: string;
}

export interface LegalFooterProps {
  /** Terms, privacy policy, and anything else the app wants to surface. */
  links: readonly LegalFooterLink[];
  /** Line above the links, e.g. "© 2026 MyClash — AGPL-3.0". */
  note?: string;
  className?: string;
}

/**
 * The strip that makes the terms and the privacy policy reachable from inside
 * the product.
 *
 * Before this existed there was no route in any app that named either document
 * — they were published on the marketing site and linked from nowhere else, so
 * a competitor who arrived on an event page had no way to reach them at all.
 *
 * Takes labels and hrefs as props rather than translating anything itself:
 * `@myclash/ui` has no i18n dependency, and the URLs are per-app (they point at
 * the marketing origin, which each app resolves through its own
 * `legal-url.ts`). Rendered outside the main landmark, so a screen reader's
 * document outline is unaffected.
 */
export const LegalFooter = ({ links, note, className = '' }: LegalFooterProps) => (
  <footer
    className={['border-t border-border px-4 py-6 text-center text-xs text-muted', className].join(
      ' ',
    )}
  >
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
    </ul>
    {note ? <p className="mt-3">{note}</p> : null}
  </footer>
);
