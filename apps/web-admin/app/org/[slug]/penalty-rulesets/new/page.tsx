import { redirect } from 'next/navigation';

/**
 * Back-compat redirect — see /org/[slug]/penalty-rulesets/page.tsx.
 */
export default function OrgPenaltyRulesetsLegacyNew({ params }: { params: { slug: string } }) {
  redirect(`/org/${params.slug}/rulesets/penalty/new`);
}
