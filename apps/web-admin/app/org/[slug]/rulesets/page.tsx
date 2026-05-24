import { redirect } from 'next/navigation';

/**
 * /org/[slug]/rulesets is the umbrella for both scoring and penalty
 * rulesets on the organizer side, mirroring the super-admin layout.
 * Default landing is /scoring — the read-only catalog tab.
 */
export default function OrgRulesetsIndexPage({ params }: { params: { slug: string } }) {
  redirect(`/org/${params.slug}/rulesets/scoring`);
}
