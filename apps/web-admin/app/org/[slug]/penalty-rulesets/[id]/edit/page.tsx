import { redirect } from 'next/navigation';

/**
 * Back-compat redirect — see /org/[slug]/penalty-rulesets/page.tsx.
 */
export default function OrgPenaltyRulesetsLegacyEdit({
  params,
}: {
  params: { slug: string; id: string };
}) {
  redirect(`/org/${params.slug}/rulesets/penalty/${params.id}/edit`);
}
