import type { MessageTree } from '../../message-tree.js';

export const metadata = {
  publicTitle: 'MyClash',
  publicDescription: 'Free, open-source platform for HEMA event management.',
  adminTitle: 'MyClash Admin',
  adminDescription: 'MyClash organizer admin and super admin.',
  scoringTitle: 'MyClash Staff',
  scoringDescription: 'Staff PWA - offline-first check-in, gear check and match scoring.',
} as const satisfies MessageTree;
