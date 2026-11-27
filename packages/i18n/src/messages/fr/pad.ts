import type { DeepString } from '../../message-tree.js';
import type { pad as enPad } from '../en/pad.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const pad = {
  quarantine: {
    boutSideMissing:
      "Conservée ici, pas perdue : cet assaut attendait un combattant. Réessayez quand les deux combattants sont sur l'assaut, ou supprimez-la.",
  },
  match: {
    waitingForFighter:
      "En attente d'un combattant. Cet assaut n'accepte ni démarrage, ni touche, ni carton, ni inversion des couleurs tant que les deux côtés ne sont pas connus.",
  },
  corrections: {
    boutSideMissing: 'Cet assaut attend un combattant. Réessayez une fois les deux côtés connus.',
  },
} as const satisfies DeepString<typeof enPad>;
