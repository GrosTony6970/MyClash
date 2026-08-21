import type { DeepString } from '../../message-tree.js';
import type { common as enCommon } from '../en/common.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const common = {
  apiFailure: {
    network: 'Serveur injoignable. Vérifiez votre connexion puis réessayez.',
    unauthenticated:
      'Votre session a expiré, ou cette page ne vous est pas destinée. Reconnectez-vous.',
    blocked: 'La connexion au serveur a été bloquée. Attendez une minute, puis réessayez.',
  },
  cancel: 'Annuler',
  error: 'Une erreur est survenue.',
  identityUnverified:
    'Impossible de confirmer votre session. Vous êtes toujours connecté — le menu peut être incomplet.',
  identityRetry: 'Réessayer',
  loading: 'Chargement...',
  passwordRules: {
    length: 'Au moins 12 caractères',
    uppercase: 'Au moins une majuscule',
    lowercase: 'Au moins une minuscule',
    digit: 'Au moins un chiffre',
    special: 'Au moins un symbole (! ? # @ …)',
  },
  refreshing: 'Actualisation...',
  none: 'Aucun',
  optional: 'Facultatif',
  saving: 'Enregistrement...',
  tooManyRequests: 'Trop de requêtes. Attendez un instant puis réessayez.',
  unknown: 'Inconnu',
  round: {
    final: 'Finale',
    semiFinal: 'Demi-finale',
    quarterFinal: 'Quart de finale',
    roundOf: 'Tableau de {count}',
    playIn: 'Barrage',
    bracketRound: 'Tour {n}',
    swissRound: 'Ronde suisse {n}',
    grandFinal: 'Grande finale',
    grandFinalReset: 'Belle de la grande finale',
    losersRound: 'Tour {n} du tableau des perdants',
    winnersFinal: 'Finale du tableau principal',
    winnersSemiFinal: 'Demi-finale du tableau principal',
    winnersQuarterFinal: 'Quart de finale du tableau principal',
    winnersRoundOf: 'Tableau principal de {count}',
    winnersRound: 'Tour {n} du tableau principal',
    columnFinals: 'Finale',
    columnSemiFinals: 'Demi-finales',
    columnQuarterFinals: 'Quarts de finale',
  },
} as const satisfies DeepString<typeof enCommon>;
