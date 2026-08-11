'use client';

import * as React from 'react';

/**
 * The class an auth form input wears.
 *
 * Exported rather than left in each app because both login pages hand-copied a
 * field class string and they had already drifted: web-admin's was `px-3 py-2
 * text-sm` with a bare `focus:ring-2`, web-public's `px-3 py-3` with a border
 * change on focus. Two owners of the same control is how a shared front door
 * stops looking shared.
 */
export const authFieldClass =
  'mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30';

/**
 * Tab styling, kept here rather than delegated to `SegmentedTabs`.
 *
 * `SegmentedTabs` paints its track `bg-surface` with a border, which is the
 * right call for a control sitting on the page. This one sits ON a raised
 * `bg-surface` panel, where that track would vanish — it needs the darker
 * `bg-background` to read as an inset well.
 */
export function authTabClass(active: boolean): string {
  return [
    'flex-1 rounded-md px-3 py-2 text-sm font-bold transition',
    active ? 'bg-accent text-accent-foreground shadow' : 'text-muted hover:text-foreground',
  ].join(' ');
}

export type AuthNoticeTone = 'success' | 'error';

export function authNoticeClass(tone: AuthNoticeTone): string {
  return tone === 'success'
    ? 'rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success'
    : 'rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger';
}

export interface AuthPanelTab<T extends string = string> {
  value: T;
  label: string;
}

export interface AuthPanelProps<T extends string = string> {
  /**
   * Accent scope. Omitted → the app's own accent (red). `'personal'` is the
   * blue personal-space accent web-public's auth uses. The panel is always
   * `data-theme="dark"`: the dark scope sets surfaces only, never the accent,
   * so the two apps share a skin and keep their own colour.
   */
  accent?: 'personal';
  /** Small caps line above the product name. */
  eyebrow: string;
  /** Product name beside the brand mark. */
  brandName: string;
  /** Hero headline — rendered as the page `<h1>`. */
  title: string;
  subtitle: string;
  /**
   * The square brand mark. A node, not a src: packages/ui has no `next`
   * dependency and must not gain one. Pass a responsively sized `<Image>` — it
   * renders at 44px on mobile and 48px in the hero.
   */
  brandMark: React.ReactNode;
  /** Wide artwork above the headline, desktop hero only. */
  heroArt?: React.ReactNode;
  /** Wraps the hero brand row in a link when set. */
  brandHref?: string;
  tabs?: ReadonlyArray<AuthPanelTab<T>>;
  activeTab?: T;
  onTabChange?: (value: T) => void;
  /** Accessible name for the tablist. Required when `tabs` is non-empty. */
  tabsLabel?: string;
  /** The form column. */
  children: React.ReactNode;
  /** Below a hairline at the bottom of the form column — a back link, usually. */
  footer?: React.ReactNode;
  /** Target for the layout's skip-link. */
  mainId?: string;
}

/**
 * The auth front door: a dark two-column panel, hero on the left, form on the
 * right, tabs at the top of the form.
 *
 * One owner for both logins. web-admin and web-public had unrelated designs for
 * the same act — a bare 384px column against a wide hero panel — so an
 * organizer who also fights met two different front doors for one account
 * system. Everything specific to an app (copy, handlers, which methods exist)
 * stays in the app; only the shell lives here.
 */
export function AuthPanel<T extends string = string>({
  accent,
  eyebrow,
  brandName,
  title,
  subtitle,
  brandMark,
  heroArt,
  brandHref,
  tabs,
  activeTab,
  onTabChange,
  tabsLabel,
  children,
  footer,
  mainId,
}: AuthPanelProps<T>): React.JSX.Element {
  const panelId = React.useId();
  const hasTabs = tabs !== undefined && tabs.length > 0;
  const activeIsTab = hasTabs && tabs.some((tab) => tab.value === activeTab);

  const brand = (
    <>
      {brandMark}
      <div>
        {/* The two rows are exclusive (`hidden lg:block` hero, `lg:hidden`
            mobile), so one responsive class pair covers both sizes. */}
        <p className="font-display text-lg font-bold lg:text-xl">{brandName}</p>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold lg:tracking-[0.22em]">
          {eyebrow}
        </p>
      </div>
    </>
  );

  return (
    <main
      id={mainId}
      data-theme="dark"
      data-accent={accent}
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6"
    >
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-lg border border-border bg-surface shadow-2xl lg:grid-cols-[1fr_460px]">
          <div className="relative hidden min-h-[560px] overflow-hidden bg-surface p-8 lg:block">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_srgb,var(--color-accent)_35%,transparent),transparent_34%),radial-gradient(circle_at_80%_10%,color-mix(in_srgb,var(--color-warning)_24%,transparent),transparent_26%),linear-gradient(135deg,var(--color-background),var(--color-surface)_55%,var(--color-border))]" />
            <div className="relative flex h-full flex-col justify-between">
              {brandHref === undefined ? (
                <div className="flex items-center gap-3">{brand}</div>
              ) : (
                <a href={brandHref} className="flex items-center gap-3">
                  {brand}
                </a>
              )}
              <div>
                {heroArt}
                <h1 className="max-w-lg text-4xl font-black leading-tight">{title}</h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-muted">{subtitle}</p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-8">
            <div className="mb-6 flex items-center gap-3 lg:hidden">{brand}</div>

            {hasTabs && (
              <div
                role="tablist"
                aria-label={tabsLabel}
                className="mb-5 flex gap-1 rounded-md bg-background p-1"
              >
                {tabs.map((tab) => {
                  const active = tab.value === activeTab;
                  return (
                    <button
                      key={tab.value}
                      id={`${panelId}-${tab.value}`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls={panelId}
                      onClick={() => onTabChange?.(tab.value)}
                      className={authTabClass(active)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div
              id={panelId}
              role={hasTabs ? 'tabpanel' : undefined}
              // Only when the active view IS one of the tabs: the reset view is
              // reached from a link inside the form, not from the tablist, and
              // pointing at an id that isn't rendered is worse than no label.
              aria-labelledby={activeIsTab ? `${panelId}-${String(activeTab)}` : undefined}
              className="space-y-4"
            >
              {children}
            </div>

            {footer !== undefined && (
              <div className="mt-4 border-t border-border pt-4">{footer}</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  /** Small print under the control. */
  hint?: string;
}

/**
 * A labelled auth input. The label wraps the control AND carries `htmlFor`, so
 * the whole row is a click target and the association survives if the two are
 * ever separated.
 *
 * Eleven copies of this block existed across the two login pages, differing in
 * padding, font size and focus ring — which is most of why the two front doors
 * looked unrelated.
 */
export function AuthField({
  id,
  label,
  hint,
  className,
  ...input
}: AuthFieldProps): React.JSX.Element {
  return (
    <label className="block" htmlFor={id}>
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input id={id} className={className ?? authFieldClass} {...input} />
      {hint !== undefined && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export interface AuthDividerProps {
  label: string;
}

/** The "or" rule between the primary action and the alternative methods. */
export function AuthDivider({ label }: AuthDividerProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export interface AuthNoticeProps {
  tone: AuthNoticeTone;
  children: React.ReactNode;
}

/**
 * The success / failure banner under an auth form. `role` follows the tone:
 * a failure interrupts, a confirmation does not.
 */
export function AuthNotice({ tone, children }: AuthNoticeProps): React.JSX.Element {
  return (
    <p className={authNoticeClass(tone)} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
