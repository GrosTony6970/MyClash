import { redirect } from 'next/navigation';

/**
 * Back-compat: /org/[slug]/penalty-rulesets moved to
 * /org/[slug]/rulesets/penalty when the organizer ruleset surface was
 * consolidated into a single "Rulesets" menu with tabs. This stub keeps
 * old bookmarks and deep links working.
 */
export default function OrgPenaltyRulesetsLegacyIndex({ params }: { params: { slug: string } }) {
  redirect(`/org/${params.slug}/rulesets/penalty`);
}
