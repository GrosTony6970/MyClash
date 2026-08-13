import type { DeepString } from '../../message-tree.js';
import type { test as enTest } from '../en/test.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const test = {
  greeting: 'Bonjour, {name}',
} as const satisfies DeepString<typeof enTest>;
