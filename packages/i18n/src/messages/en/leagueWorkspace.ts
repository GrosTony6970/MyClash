import type { MessageTree } from '../../message-tree.js';

export const leagueWorkspace = {
  eyebrow: 'League workspace',
  role: 'League admin',
  list: {
    empty: 'No league has been assigned to you yet.',
    viaDirect: 'Direct grant',
    viaOrg: 'Via {organization}',
    viaSuperAdmin: 'Super admin',
  },
} as const satisfies MessageTree;
