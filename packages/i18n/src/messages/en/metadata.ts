import type { MessageTree } from '../../message-tree.js';

export const metadata = {
  publicTitle: 'MyClash',
  publicDescription: 'Free, open-source platform for HEMA event management.',
  adminTitle: 'MyClash Admin',
  adminDescription: 'MyClash organizer admin and super admin.',
  scoringTitle: 'MyClash Scoring',
  scoringDescription: 'Scorekeeper PWA - offline-first match exchange recording.',
} as const satisfies MessageTree;
