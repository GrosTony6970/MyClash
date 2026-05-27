import { redirect } from 'next/navigation';

/**
 * Back-compat redirect — see /org/[slug]/penalty-rulesets/page.tsx.
 */
export default async function OrgPenaltyRulesetsLegacyEdit({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  redirect(`/org/${slug}/rulesets/penalty/${id}/edit`);
}
