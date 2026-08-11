/**
 * Landing-page copy, both locales side by side.
 *
 * The markup lives once in components/Home.astro and reads from here, so the
 * French and English pages cannot structurally diverge — and a missing string
 * is a type error rather than an English sentence on the French page.
 */
import type { Locale } from './ui';

export interface Feature {
  readonly title: string;
  readonly text: string;
}

export interface Step {
  readonly title: string;
  readonly text: string;
}

export interface ContributionType {
  readonly badge: string;
  readonly text: string;
}

export interface HomeCopy {
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly ogDescription: string;

  readonly heroEyebrow: string;
  readonly heroTitleLead: string;
  readonly heroTitleAccent: string;
  readonly heroSubtitle: string;
  readonly heroCtaPrimary: string;
  readonly heroCtaSecondary: string;
  readonly heroScroll: string;
  readonly heroImageAlt: string;

  readonly statsAria: string;
  readonly statsHeading: string;
  readonly statLabels: readonly [string, string, string];

  readonly featuresTag: string;
  readonly featuresTitle: string;
  readonly featuresLead: string;
  readonly features: readonly Feature[];

  readonly stepsTag: string;
  readonly stepsTitle: string;
  readonly stepsLead: string;
  readonly steps: readonly Step[];

  readonly ctaTag: string;
  readonly ctaTitleLead: string;
  readonly ctaTitleTail: string;
  readonly ctaLead: string;
  readonly ctaPrimary: string;
  readonly ctaSecondary: string;

  readonly contribTag: string;
  readonly contribTitle: string;
  readonly contribTagline: string;
  readonly contribBullets: readonly string[];
  readonly contribDonate: string;
  readonly contribBoxTitle: string;
  readonly contribBoxText: string;
  readonly contribHighlightLabel: string;
  readonly contribHighlightText: string;
  readonly contribHowTitle: string;
  readonly contribTypes: readonly [ContributionType, ContributionType];
}

const fr: HomeCopy = {
  metaTitle: 'MyClash - Gestionnaire de tournois AMHE',
  metaDescription:
    'MyClash aide les organisateurs AMHE à gérer inscriptions, scoring offline-first, résultats publics et classements depuis une plateforme open source.',
  ogDescription:
    'Organisez vos événements AMHE, scorez même avec un mauvais wifi et publiez les résultats en temps réel avec MyClash.',

  heroEyebrow: 'Gestionnaire de Tournois AMHE',
  heroTitleLead: 'Gérez vos tournois',
  heroTitleAccent: 'comme un champion',
  heroSubtitle:
    "La plateforme tout-en-un pour organiser, scorer et analyser vos compétitions d'arts martiaux historiques européens. Conçue avec une interface moderne, des comptes combattants personnalisés et des statistiques détaillées — pour que chaque compétiteur puisse suivre sa progression. Inspirée par Hemascorecard. Gratuite, open-source, puissante.",
  heroCtaPrimary: 'Commencer gratuitement',
  heroCtaSecondary: 'Découvrir',
  heroScroll: 'Défiler',
  heroImageAlt: '',

  statsAria: 'Chiffres clés',
  statsHeading: 'Chiffres clés',
  statLabels: ['Tournois organisés', 'Clubs participants', 'Combattants inscrits'],

  featuresTag: 'Fonctionnalités',
  featuresTitle: 'Tout ce dont vous avez besoin',
  featuresLead:
    "De la création de l'événement au palmarès final, MyClash couvre chaque étape de votre compétition AMHE.",
  features: [
    {
      title: 'Gestion des tableaux',
      text: 'Créez et gérez vos tournois avec des formats entièrement personnalisables : poules, élimination directe, double élimination, et plus encore.',
    },
    {
      title: 'Score en direct',
      text: 'Interface de score optimisée pour tablette, synchronisée en temps réel pour tous les spectateurs présents ou connectés à distance.',
    },
    {
      title: 'Multi-clubs',
      text: 'Gérez plusieurs clubs et événements depuis un seul tableau de bord. Permissions granulaires, rôles organisateur, arbitres et spectateurs.',
    },
    {
      title: 'Statistiques & classements',
      text: "Suivez les performances, générez des rapports et publiez vos classements automatiquement à l'issue de chaque compétition.",
    },
    {
      title: 'Accès public & PWA',
      text: "Les combattants et spectateurs suivent les combats en direct sur leur téléphone, sans installation, depuis n'importe quel navigateur.",
    },
    {
      title: 'Sécurité & confidentialité',
      text: 'Authentification sécurisée, gestion des rôles et des accès, hébergement souverain en Europe. Vos données vous appartiennent.',
    },
  ],

  stepsTag: 'Simplicité',
  stepsTitle: 'Prêt en 3 étapes',
  stepsLead: 'Lancez votre premier tournoi en moins de 10 minutes.',
  steps: [
    {
      title: 'Créez votre événement',
      text: 'Configurez votre tournoi en quelques minutes : discipline, format, catégories et règlement.',
    },
    {
      title: 'Inscrivez vos combattants',
      text: 'Import en masse par fichier ou inscription individuelle. MyClash gère les poules automatiquement.',
    },
    {
      title: 'Lancez la compétition',
      text: 'Score en direct, résultats instantanés, classements publiés en temps réel pour tous.',
    },
  ],

  ctaTag: "Commencez dès aujourd'hui",
  ctaTitleLead: 'Votre prochain tournoi',
  ctaTitleTail: 'mérite MyClash',
  ctaLead:
    'Gratuit, sans carte bancaire, sans engagement. Rejoignez la communauté AMHE qui fait confiance à MyClash.',
  ctaPrimary: 'Commencer gratuitement',
  ctaSecondary: 'Nous contacter',

  // NOTE: the strings below are English on the French page. That is finding #5
  // of the marketing review, carried across verbatim so this migration stays
  // content-equivalent and any visual regression is attributable to the move
  // rather than to a rewrite. The translation lands in the copy commit.
  contribTag: 'Open Source & Gratuit',
  contribTitle: 'Support the MyClash Project',
  contribTagline:
    'Thank you for being a part of our community! We are committed to keeping MyClash accessible, transparent, and evolving.',
  contribBullets: [
    'MyClash is — and will always be — free and open-source. We believe powerful tools should be available to everyone without a paywall.',
    'Our code is public because we value community collaboration and trust.',
    'Running high-performance servers and maintaining infrastructure carries monthly overhead.',
    "We don't take a salary or profit from your generosity. Your support ensures the project stays fast, stable, and available 24/7.",
  ],
  contribDonate: 'Faire un don',
  contribBoxTitle: 'Where Your Donation Goes',
  contribBoxText:
    'Every cent donated goes directly toward hosting costs and infrastructure maintenance. 100% transparency — always.',
  contribHighlightLabel: '100% Transparency:',
  contribHighlightText:
    'Every cent donated goes directly toward hosting costs and infrastructure maintenance. We publish our running costs.',
  contribHowTitle: 'How to Contribute',
  contribTypes: [
    { badge: 'Ponctuel', text: 'Perfect for a quick "thank you." Any amount makes a difference.' },
    {
      badge: 'Mensuel',
      text: 'Helps us predict and cover our recurring server bills. Cancel anytime.',
    },
  ],
};

const en: HomeCopy = {
  metaTitle: 'MyClash - HEMA tournament manager',
  metaDescription:
    'MyClash helps HEMA organizers manage registrations, offline-first scoring, public results and rankings from a free open-source platform.',
  ogDescription:
    'Run HEMA events, score reliably in poor wifi, and publish live results with MyClash.',

  heroEyebrow: 'HEMA Tournament Manager',
  heroTitleLead: 'Run your tournaments',
  heroTitleAccent: 'with confidence',
  heroSubtitle:
    'The all-in-one platform to organize, score, and analyze your Historical European Martial Arts competitions. Built with a modern look and feel, personalized fighter accounts, and rich statistics — so every competitor can track their journey. Inspired by Hemascorecard. Free, open-source, powerful.',
  heroCtaPrimary: 'Start for free',
  heroCtaSecondary: 'Explore',
  heroScroll: 'Scroll',
  heroImageAlt: '',

  statsAria: 'Key figures',
  statsHeading: 'Key figures',
  statLabels: ['Tournaments organized', 'Participating clubs', 'Registered fighters'],

  featuresTag: 'Features',
  featuresTitle: 'Everything you need',
  featuresLead:
    'From event creation to final results, MyClash covers every step of your HEMA competition.',
  features: [
    {
      title: 'Bracket management',
      text: 'Create and manage tournaments with fully customizable formats: pools, direct elimination, double elimination, and more.',
    },
    {
      title: 'Live scoring',
      text: 'Tablet-optimized scoring, synchronized in real time for spectators on site or following remotely.',
    },
    {
      title: 'Multi-club',
      text: 'Manage multiple clubs and events from one dashboard. Granular permissions for organizers, referees and spectators.',
    },
    {
      title: 'Statistics & standings',
      text: 'Track performance, generate reports and publish standings automatically at the end of each competition.',
    },
    {
      title: 'Public access & PWA',
      text: 'Fighters and spectators follow bouts live on their phones, with no installation, from any browser.',
    },
    {
      title: 'Security & privacy',
      text: 'Secure authentication, role and access management, and sovereign hosting in Europe. Your data remains yours.',
    },
  ],

  stepsTag: 'Simple workflow',
  stepsTitle: 'Ready in 3 steps',
  stepsLead: 'Launch your first tournament in under 10 minutes.',
  steps: [
    {
      title: 'Create your event',
      text: 'Configure your tournament in minutes: discipline, format, categories and ruleset.',
    },
    {
      title: 'Register fighters',
      text: 'Bulk import from files or add individual registrations. MyClash generates pools automatically.',
    },
    {
      title: 'Start the competition',
      text: 'Live scoring, instant results and standings published in real time for everyone.',
    },
  ],

  ctaTag: 'Start today',
  ctaTitleLead: 'Your next tournament',
  ctaTitleTail: 'deserves MyClash',
  ctaLead: 'Free, no credit card, no commitment. Join the HEMA community that trusts MyClash.',
  ctaPrimary: 'Start for free',
  ctaSecondary: 'Contact us',

  contribTag: 'Open Source & Free',
  contribTitle: 'Support the MyClash Project',
  contribTagline:
    'Thank you for being a part of our community! We are committed to keeping MyClash accessible, transparent, and evolving.',
  contribBullets: [
    'MyClash is — and will always be — free and open-source. We believe powerful tools should be available to everyone without a paywall.',
    'Our code is public because we value community collaboration and trust.',
    'Running high-performance servers and maintaining infrastructure carries monthly overhead.',
    "We don't take a salary or profit from your generosity. Your support ensures the project stays fast, stable, and available 24/7.",
  ],
  contribDonate: 'Donate',
  contribBoxTitle: 'Where Your Donation Goes',
  contribBoxText:
    'Every cent donated goes directly toward hosting costs and infrastructure maintenance. 100% transparency — always.',
  contribHighlightLabel: '100% Transparency:',
  contribHighlightText:
    'Every cent donated goes directly toward hosting costs and infrastructure maintenance. We publish our running costs.',
  contribHowTitle: 'How to Contribute',
  contribTypes: [
    { badge: 'One-time', text: 'Perfect for a quick "thank you." Any amount makes a difference.' },
    {
      badge: 'Monthly',
      text: 'Helps us predict and cover our recurring server bills. Cancel anytime.',
    },
  ],
};

export const HOME: Readonly<Record<Locale, HomeCopy>> = { fr, en };

/** Hardcoded adoption figures. Replaced by live counts in a later commit. */
export const STAT_VALUES = [120, 45, 3000] as const;

/** Feature-card icons, in the order the cards are listed. Language-independent. */
export const FEATURE_ICON_PATHS: readonly string[] = [
  'M3 10h18M3 6h18M3 14h10M3 18h6',
  'M13 10V3L4 14h7v7l9-11h-7z',
  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0',
  'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0120 9.414V19a2 2 0 01-2 2z',
  'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
  'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
];

export const DONATION_URL = 'https://www.helloasso.com/associations/lyon-amhe/formulaires/2';
