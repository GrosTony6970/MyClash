import type { DeepString } from '../../message-tree.js';
import type { leagueWorkspace as enLeagueWorkspace } from '../en/leagueWorkspace.js';

// Locked to EN's exact shape: a missing or extra key is a tsc error here,
// which is the guarantee the single-file `satisfies Messages` used to give.
export const leagueWorkspace = {
  eyebrow: 'Espace ligues',
  role: 'Administrateur de ligue',
  list: {
    empty: 'Aucune ligue ne vous a encore été attribuée.',
    viaDirect: 'Accès direct',
    viaOrg: 'Via {organization}',
    viaSuperAdmin: 'Super admin',
  },
} as const satisfies DeepString<typeof enLeagueWorkspace>;
