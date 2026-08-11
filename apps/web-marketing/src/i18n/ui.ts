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
  readonly navCta: string;
  readonly footerNavAria: string;
  readonly footerApp: string;
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
    navCta: 'Connexion',
    footerNavAria: 'Navigation pied de page',
    footerApp: 'Application',
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
    navCta: 'Sign in',
    footerNavAria: 'Footer navigation',
    footerApp: 'App',
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
export const REPO_URL = 'https://github.com/GrosTony6970/MyClash';
export const ASSOCIATION_URL = 'https://www.helloasso.com/associations/lyon-amhe';
