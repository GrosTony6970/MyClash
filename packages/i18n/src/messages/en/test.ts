import type { MessageTree } from '../../message-tree.js';

export const test = {
  greeting: 'Hello, {name}',
} as const satisfies MessageTree;
