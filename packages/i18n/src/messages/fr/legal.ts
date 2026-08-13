import type { DeepString } from '../../message-tree.js';
import type { legal as enLegal } from '../en/legal.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const legal = {
  terms: "Conditions d'utilisation",
  privacy: 'Politique de confidentialité',
  footerNote: 'MyClash — open source, AGPL-3.0',
  accept: {
    label: "J'ai lu et j'accepte les {terms} et la {privacy}.",
    required:
      "Veuillez accepter les conditions d'utilisation et la politique de confidentialité pour continuer.",
    stale:
      "Les conditions d'utilisation ou la politique de confidentialité ont changé. Rechargez la page et acceptez la version en vigueur.",
  },
  guestNotice: 'En continuant, vous acceptez les {terms} et la {privacy}.',
  banner: {
    title: 'Nos conditions ont été mises à jour',
    body: 'Merci de consulter et d’accepter la version en vigueur pour continuer à utiliser MyClash.',
    review: 'Consulter et accepter',
    accepting: 'Enregistrement…',
    dismiss: 'Plus tard',
  },
  settings: {
    title: 'Vos acceptations',
    description: 'Ce que vous avez accepté, et quand.',
    acceptedOn: 'Accepté le {date}',
    version: 'Version {version}',
    outdated: 'Une version plus récente a été publiée',
    notAccepted: 'Pas encore accepté',
    acceptCurrent: 'Accepter la version en vigueur',
  },
} as const satisfies DeepString<typeof enLegal>;
