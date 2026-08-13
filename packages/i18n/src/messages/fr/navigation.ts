import type { DeepString } from '../../message-tree.js';
import type { navigation as enNavigation } from '../en/navigation.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const navigation = {
  skipToMainContent: 'Passer au contenu principal',
  languageSwitcher: 'Langue',
  languageEnglish: 'English',
  languageFrench: 'Français',
} as const satisfies DeepString<typeof enNavigation>;
