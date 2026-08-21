import type { DeepString } from '../../message-tree.js';
import type { metadata as enMetadata } from '../en/metadata.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const metadata = {
  publicTitle: 'MyClash',
  publicDescription: "Plateforme libre et open-source pour la gestion d'événements d'AMHE.",
  adminTitle: 'MyClash Admin',
  adminDescription: 'Administration MyClash pour les organisateurs et super-administrateurs.',
  scoringTitle: 'MyClash Staff',
  scoringDescription:
    'Application staff - accueil, contrôle du matériel et saisie des scores hors ligne.',
} as const satisfies DeepString<typeof enMetadata>;
