import type { DeepString } from '../../message-tree.js';
import type { offline as enOffline } from '../en/offline.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const offline = {
  title: 'Vous êtes hors ligne',
  description:
    'Pas de connexion internet. Les échanges saisis hors ligne seront synchronisés automatiquement au retour de la connexion.',
  tryAgain: 'Réessayer',
} as const satisfies DeepString<typeof enOffline>;
