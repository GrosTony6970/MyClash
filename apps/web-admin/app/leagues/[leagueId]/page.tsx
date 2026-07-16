'use client';

import { useParams } from 'next/navigation';
import { LeagueManageView } from '../../../src/components/league/LeagueManageView';

/**
 * Personal league management — the same view the org workspace renders, loaded
 * without an org to scope to. Authorization is the API's: every
 * /admin/leagues/* endpoint asserts manage rights per league.
 */
export default function PersonalLeagueManagePage() {
  const params = useParams<{ leagueId: string }>();
  return (
    <LeagueManageView
      leagueId={params.leagueId}
      backHref="/leagues"
      source={{ kind: 'personal' }}
    />
  );
}
