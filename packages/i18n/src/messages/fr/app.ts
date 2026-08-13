import type { DeepString } from '../../message-tree.js';
import type { app as enApp } from '../en/app.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const app = {
  name: 'MyClash',
} as const satisfies DeepString<typeof enApp>;
