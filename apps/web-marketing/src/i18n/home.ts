/**
 * Landing-page copy, both locales side by side.
 *
 * The markup lives once in components/Home.astro and reads from here, so the
 * French and English pages cannot structurally diverge — and a missing string
 * is a type error rather than an English sentence on the French page.
 *
 * Everything claimed below is something the platform does today. The previous
 * copy described a bracket tool with six generic cards: it never mentioned
 * offline scoring (the differentiator, which appeared only in a meta tag), hid
 * Swiss behind "et plus encore", and said nothing about leagues, workshops,
 * referee compensation, HEMA Ratings export or fighter accounts.
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

  heroEyebrow: 'Plateforme AMHE — libre et gratuite',
  heroTitleLead: 'Gérez vos tournois',
  heroTitleAccent: 'comme un champion',
  heroSubtitle:
    "Inscriptions, poules, arbitrage et classements, d'un bout à l'autre de votre événement AMHE. Et un pad de scoring qui continue de fonctionner quand le réseau de la salle vous lâche.",
  heroCtaPrimary: 'Créer mon événement',
  heroCtaSecondary: 'Voir les événements',
  heroScroll: 'Défiler',
  heroImageAlt: '',

  statsHeading: 'Chiffres clés',
  statLabels: ['Événements publiés', 'Clubs référencés', 'Combattants inscrits'],

  featuresTag: 'Fonctionnalités',
  featuresTitle: 'Tout ce dont vous avez besoin',
  featuresLead:
    "De la création de l'événement au palmarès final, MyClash couvre chaque étape de votre compétition AMHE.",
  features: [
    {
      title: 'Le scoring marche sans réseau',
      text: "Le pad d'arbitrage fonctionne hors ligne, de bout en bout : les échanges sont saisis, horodatés et conservés sur la tablette, puis synchronisés dès que la connexion revient. Un gymnase sans wifi n'arrête pas votre compétition.",
    },
    {
      title: 'Poules, tableaux, et suisse',
      text: 'Poules, élimination directe, double élimination et rondes suisses. Tirages, têtes de série et reclassements sont calculés par le moteur de règles — jamais saisis à la main dans un tableur.',
    },
    {
      title: 'Résultats en direct, sur tous les écrans',
      text: 'Combattants et spectateurs suivent les combats depuis leur téléphone, sans rien installer. Les écrans de la salle affichent la piste en cours, le programme et les classements, mis à jour en temps réel.',
    },
    {
      title: 'Ligues et classements de saison',
      text: 'Reliez plusieurs événements en une ligue : classements individuels et par club, cumulés sur la saison, publiés automatiquement et exportables.',
    },
    {
      title: 'Arbitres : affectation et indemnisation',
      text: "Qualifications, disponibilités et affectation aux pistes, avec la garantie qu'un combattant n'arbitre jamais une poule qui recoupe ses propres combats. Les indemnités se calculent depuis un barème par rôle, avec plancher de paiement.",
    },
    {
      title: 'Les stages aussi, pas que les tournois',
      text: "Un événement AMHE, ce n'est pas seulement des combats. Programmez vos ateliers, gérez les inscriptions et les intervenants, et récoltez les retours des participants après coup.",
    },
    {
      title: 'Comptes combattants et statistiques',
      text: "Chaque compétiteur dispose d'un profil : palmarès, historique de combats, statistiques par arme, cartons reçus. Les résultats s'exportent au format HEMA Ratings pour alimenter le classement international.",
    },
    {
      title: 'Vos données restent les vôtres',
      text: 'Hébergement en France, code source ouvert et auditable, export complet de vos données en un clic — pour un événement comme pour un compte personnel. Aucun traceur, aucune publicité, aucune revente.',
    },
  ],

  stepsTag: 'Simplicité',
  stepsTitle: 'Prêt en 3 étapes',
  stepsLead: 'Lancez votre premier tournoi en moins de 10 minutes.',
  steps: [
    {
      title: 'Créez votre événement',
      text: 'Discipline, format, catégories et règlement. Les jeux de règles existants sont réutilisables tels quels.',
    },
    {
      title: 'Inscrivez vos combattants',
      text: 'Import en masse par fichier ou inscription individuelle. MyClash compose les poules et les tableaux.',
    },
    {
      title: 'Lancez la compétition',
      text: 'Les arbitres scorent sur tablette, la salle et le public suivent en direct, les classements se publient seuls.',
    },
  ],

  ctaTag: "Commencez dès aujourd'hui",
  ctaTitleLead: 'Votre prochain tournoi',
  ctaTitleTail: 'mérite MyClash',
  ctaLead:
    'Gratuit, sans carte bancaire, sans engagement. Rejoignez la communauté AMHE qui fait confiance à MyClash.',
  ctaPrimary: 'Créer mon événement',
  ctaSecondary: 'Nous contacter',

  contribTag: 'Open Source & Gratuit',
  contribTitle: 'Soutenir le projet MyClash',
  contribTagline:
    'Merci de faire partie de cette communauté. Nous nous engageons à garder MyClash accessible, transparent, et vivant.',
  contribBullets: [
    'MyClash est — et restera — libre et gratuit. Un outil de ce genre doit être accessible à tous, sans péage.',
    'Notre code est public parce que nous croyons à la collaboration et à la confiance.',
    "Faire tourner des serveurs et maintenir l'infrastructure représente un coût mensuel.",
    'Nous ne prenons ni salaire ni bénéfice sur vos dons. Votre soutien garantit que le projet reste rapide, stable et disponible 24h/24.',
  ],
  contribDonate: 'Faire un don',
  contribBoxTitle: 'Où va votre don',
  contribHighlightLabel: '100 % de transparence :',
  contribHighlightText:
    "chaque centime donné va à l'hébergement et à la maintenance de l'infrastructure. Nous publions nos coûts de fonctionnement.",
  contribHowTitle: 'Comment contribuer',
  contribTypes: [
    {
      badge: 'Ponctuel',
      text: 'Idéal pour un simple « merci ». Chaque montant compte.',
    },
    {
      badge: 'Mensuel',
      text: 'Nous aide à anticiper et couvrir les factures récurrentes. Résiliable à tout moment.',
    },
  ],
};

const en: HomeCopy = {
  metaTitle: 'MyClash - HEMA tournament manager',
  metaDescription:
    'MyClash helps HEMA organizers manage registrations, offline-first scoring, public results and rankings from a free open-source platform.',
  ogDescription:
    'Run HEMA events, score reliably in poor wifi, and publish live results with MyClash.',

  heroEyebrow: 'HEMA platform — free and open source',
  heroTitleLead: 'Run your tournaments',
  heroTitleAccent: 'with confidence',
  heroSubtitle:
    'Registration, pools, scoring and standings, end to end for your HEMA event. And a scoring pad that keeps working when the venue wifi does not.',
  heroCtaPrimary: 'Create my event',
  heroCtaSecondary: 'Browse events',
  heroScroll: 'Scroll',
  heroImageAlt: '',

  statsHeading: 'Key figures',
  statLabels: ['Published events', 'Clubs on the platform', 'Registered fighters'],

  featuresTag: 'Features',
  featuresTitle: 'Everything you need',
  featuresLead:
    'From event creation to final results, MyClash covers every step of your HEMA competition.',
  features: [
    {
      title: 'Scoring works with no network',
      text: 'The referee pad runs fully offline: exchanges are entered, timestamped and held on the tablet, then synced the moment connectivity returns. A sports hall with no wifi does not stop your competition.',
    },
    {
      title: 'Pools, brackets, and Swiss',
      text: 'Pools, single elimination, double elimination and Swiss rounds. Draws, seeding and re-seeding are computed by the ruleset engine — never typed into a spreadsheet by hand.',
    },
    {
      title: 'Live results on every screen',
      text: 'Fighters and spectators follow bouts from their phones with nothing to install. Venue screens show the current piste, the programme and the standings, updated in real time.',
    },
    {
      title: 'Leagues and season standings',
      text: 'Link several events into a league: individual and club standings, accumulated across the season, published automatically and exportable.',
    },
    {
      title: 'Referees: assignment and pay',
      text: 'Qualifications, availability and piste assignment, with a hard guarantee that a fighter never referees a pool overlapping their own bouts. Compensation is computed from a per-role rate card with a minimum payout floor.',
    },
    {
      title: 'Workshops too, not just bouts',
      text: 'A HEMA event is more than fighting. Schedule your workshops, manage enrolment and instructors, and collect participant feedback once they are over.',
    },
    {
      title: 'Fighter accounts and statistics',
      text: 'Every competitor gets a profile: honours, bout history, per-weapon statistics, cards received. Results export in HEMA Ratings format to feed the international rating.',
    },
    {
      title: 'Your data stays yours',
      text: 'Hosted in France, source code open and auditable, one-click full export of your data — for an event as much as for a personal account. No trackers, no advertising, nothing sold on.',
    },
  ],

  stepsTag: 'Simple workflow',
  stepsTitle: 'Ready in 3 steps',
  stepsLead: 'Launch your first tournament in under 10 minutes.',
  steps: [
    {
      title: 'Create your event',
      text: 'Discipline, format, categories and ruleset. Existing rulesets can be reused as they are.',
    },
    {
      title: 'Register fighters',
      text: 'Bulk import from a file or add individual registrations. MyClash builds the pools and the brackets.',
    },
    {
      title: 'Start the competition',
      text: 'Referees score on tablets, the venue and the public follow live, standings publish themselves.',
    },
  ],

  ctaTag: 'Start today',
  ctaTitleLead: 'Your next tournament',
  ctaTitleTail: 'deserves MyClash',
  ctaLead: 'Free, no credit card, no commitment. Join the HEMA community that trusts MyClash.',
  ctaPrimary: 'Create my event',
  ctaSecondary: 'Contact us',

  contribTag: 'Open Source & Free',
  contribTitle: 'Support the MyClash project',
  contribTagline:
    'Thank you for being part of this community. We are committed to keeping MyClash accessible, transparent, and evolving.',
  contribBullets: [
    'MyClash is — and will always be — free and open source. A tool like this should be available to everyone, without a paywall.',
    'Our code is public because we value collaboration and trust.',
    'Running servers and maintaining infrastructure carries a monthly cost.',
    'We take no salary and no profit from your generosity. Your support keeps the project fast, stable, and available around the clock.',
  ],
  contribDonate: 'Donate',
  contribBoxTitle: 'Where your donation goes',
  contribHighlightLabel: '100% transparency:',
  contribHighlightText:
    'every cent donated goes to hosting and infrastructure maintenance. We publish our running costs.',
  contribHowTitle: 'How to contribute',
  contribTypes: [
    { badge: 'One-time', text: 'Ideal for a quick "thank you". Any amount makes a difference.' },
    {
      badge: 'Monthly',
      text: 'Helps us anticipate and cover the recurring bills. Cancel any time.',
    },
  ],
};

export const HOME: Readonly<Record<Locale, HomeCopy>> = { fr, en };

/**
 * Feature-card icons, in card order. Language-independent.
 *
 * An array per card because the offline icon needs two strokes — a signal arc
 * and the slash through it.
 */
export const FEATURE_ICON_PATHS: readonly (readonly string[])[] = [
  // no-network scoring
  [
    'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0',
    'M3 3l18 18',
  ],
  // brackets
  ['M3 10h18M3 6h18M3 14h10M3 18h6'],
  // live screens
  ['M8 21h8m-4-4v4M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'],
  // league trophy
  ['M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a4 4 0 004 4M17 6h3v1a4 4 0 01-4 4'],
  // referees
  [
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0',
  ],
  // workshops
  [
    'M12 14l9-5-9-5-9 5 9 5z',
    'M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
  ],
  // stats
  [
    'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0120 9.414V19a2 2 0 01-2 2z',
  ],
  // data ownership
  [
    'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  ],
];

export const DONATION_URL = 'https://www.helloasso.com/associations/lyon-amhe/formulaires/2';
