import type { MessageTree } from '../../message-tree.js';

export const offline = {
  title: "You're offline",
  description:
    'No internet connection. Exchanges entered while offline will sync automatically when you reconnect.',
  tryAgain: 'Try again',
} as const satisfies MessageTree;
