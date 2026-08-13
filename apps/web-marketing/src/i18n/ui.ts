/**
 * The strings that appear on every page — nav, footer, and the labels the
 * layout needs. Page body copy stays in its own .astro file.
 *
 * Two locales, one object, so a missing translation is a TypeScript error
 * rather than an English sentence that ships on the French page. That is the
 * failure this file exists to prevent: the support section of the FR landing
 * page was English top to bottom for as long as the site has been up, because
 * nothing connected the two documents.
 */

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'fr';

/** Where each locale's copy of a page lives. `fr` is at the root, `en` under /en. */
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const base = clean === '/' ? '' : clean;
  return locale === 'fr' ? base || '/' : `/en${base}`;
}

interface Chrome {
  readonly htmlLang: string;
  readonly ogLocale: string;
  readonly skipToContent: string;
  readonly homeAria: string;
  readonly menuAria: string;
  readonly navFeatures: string;
  readonly navHowItWorks: string;
  readonly navSupport: string;
  /**
   * The app link. One string because the nav and the footer point at the same
   * URL — a `footer`-prefixed name read from the nav would be a lie, and two
   * names is how the same link ends up with two labels.
   */
  readonly appLink: string;
  readonly navCta: string;
  readonly footerNavAria: string;
  readonly footerPrivacy: string;
  readonly footerTerms: string;
  readonly footerContact: string;
  readonly footerDevelopedBy: string;
  readonly badgeHema: string;
  /** Label for the link that switches to the *other* language. */
  readonly switchLabel: string;
  readonly switchAria: string;
}

export const CHROME: Readonly<Record<Locale, Chrome>> = {
  fr: {
    htmlLang: 'fr',
    ogLocale: 'fr_FR',
    skipToContent: 'Aller au contenu',
    homeAria: 'MyClash accueil',
    menuAria: 'Menu',
    navFeatures: 'Fonctionnalités',
    navHowItWorks: 'Comment ça marche',
    navSupport: 'Soutenir',
    appLink: 'Application',
    navCta: 'Connexion',
    footerNavAria: 'Navigation pied de page',
    footerPrivacy: 'Confidentialité',
    footerTerms: 'CGU',
    footerContact: 'Contact',
    footerDevelopedBy: 'MyClash développé par',
    badgeHema: 'AMHE',
    switchLabel: 'English',
    switchAria: 'Switch to English',
  },
  en: {
    htmlLang: 'en',
    ogLocale: 'en_GB',
    skipToContent: 'Skip to content',
    homeAria: 'MyClash home',
    menuAria: 'Menu',
    navFeatures: 'Features',
    navHowItWorks: 'How it works',
    navSupport: 'Support',
    appLink: 'App',
    navCta: 'Sign in',
    footerNavAria: 'Footer navigation',
    footerPrivacy: 'Privacy',
    footerTerms: 'Terms',
    footerContact: 'Contact',
    footerDevelopedBy: 'MyClash developed by',
    badgeHema: 'HEMA',
    switchLabel: 'Français',
    switchAria: 'Passer en français',
  },
};

/** Anchors on the landing page. Shared by the nav and the footer, both locales. */
export const SECTION_IDS = {
  features: 'fonctionnalites',
  howItWorks: 'comment',
  support: 'soutenir',
} as const;

export const CONTACT_EMAIL = 'admin@myclash.fr';
export const APP_URL = 'https://app.myclash.fr';
/**
 * Where the "Connexion" CTA goes. Separate from `APP_URL` because the two nav
 * items lead to different places: the "Application" link opens the app, the CTA
 * opens the front door. Pointing the CTA at the root dropped a visitor who had
 * just clicked a button labelled *Connexion* onto the events browser, where
 * they had to find the sign-in button again.
 */
export const APP_LOGIN_URL = `${APP_URL}/login`;
/** Organiser workspace — where "create my event" goes. */
export const ADMIN_URL = 'https://admin.myclash.fr';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/**
 * Where the marketing page reads its adoption counts.
 *
 * Baked in at build time from the `PUBLIC_API_URL` build arg (see the
 * Dockerfile and both compose files). The default is the production host so a
 * plain `astro build` outside Docker still produces a working page.
 */
export const API_URL = import.meta.env.PUBLIC_API_URL ?? 'https://api.myclash.fr';
export const REPO_URL = 'https://github.com/GrosTony6970/MyClash';
export const ASSOCIATION_URL = 'https://www.helloasso.com/associations/lyon-amhe';
