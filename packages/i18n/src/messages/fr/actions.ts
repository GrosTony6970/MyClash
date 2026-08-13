import type { DeepString } from '../../message-tree.js';
import type { actions as enActions } from '../en/actions.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const actions = {
  add: 'Ajouter',
  apply: 'Appliquer',
  back: 'Retour',
  cancel: 'Annuler',
  clear: 'Effacer',
  close: 'Fermer',
  delete: 'Supprimer',
  dismiss: 'Fermer',
  edit: 'Modifier',
  next: 'Suivant',
  reject: 'Rejeter',
  remove: 'Retirer',
  retry: 'Reessayer',
  refresh: 'Rafraichir',
  save: 'Enregistrer',
  search: 'Rechercher',
  view: 'Voir',
} as const satisfies DeepString<typeof enActions>;
