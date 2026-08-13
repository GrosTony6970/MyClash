import type { MessageTree } from '../../message-tree.js';

export const navigation = {
  skipToMainContent: 'Skip to main content',
  languageSwitcher: 'Language',
  languageEnglish: 'English',
  languageFrench: 'Français',
} as const satisfies MessageTree;
