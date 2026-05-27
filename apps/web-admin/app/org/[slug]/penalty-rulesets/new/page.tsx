import { redirect } from 'next/navigation';

/**
 * Back-compat redirect — see /org/[slug]/penalty-rulesets/page.tsx.
 */
export default async function OrgPenaltyRulesetsLegacyNew({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/org/${slug}/rulesets/penalty/new`);
}
