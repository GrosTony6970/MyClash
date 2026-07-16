'use client';

import { useParams } from 'next/navigation';
import { LeagueManageView } from '../../../../../src/components/league/LeagueManageView';

/**
 * Org-scoped league management. The view itself is shared with the personal
 * workspace at /leagues/[leagueId]; only the loader and the back-link differ.
 */
export default function OrgLeagueManagePage() {
  const params = useParams<{ slug: string; leagueId: string }>();
  return (
    <LeagueManageView
      leagueId={params.leagueId}
      backHref={`/org/${params.slug}/leagues`}
      source={{ kind: 'org', slug: params.slug }}
    />
  );
}
