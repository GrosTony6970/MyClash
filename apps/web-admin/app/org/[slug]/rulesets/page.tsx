import { redirect } from 'next/navigation';

/**
 * /org/[slug]/rulesets is the umbrella for both scoring and penalty
 * rulesets on the organizer side, mirroring the super-admin layout.
 * Default landing is /scoring — the read-only catalog tab.
 *
 * Next 15/16 made `params` a Promise on server components — reading
 * `.slug` synchronously yields undefined and the redirect target
 * collapses to `/org/undefined/...`, which the org-shell auth gate
 * then bounces to /login. Always `await params` here.
 */
export default async function OrgRulesetsIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/org/${slug}/rulesets/scoring`);
}
