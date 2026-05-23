import { redirect } from 'next/navigation';

/**
 * /admin/rulesets is the umbrella for both scoring and penalty rulesets.
 * The two live as siblings — /admin/rulesets/scoring (curated scoring
 * rulesets + submissions) and /admin/rulesets/penalty (penalty rulesets).
 * The default landing is the scoring page since it predates the split.
 */
export default function AdminRulesetsIndexPage() {
  redirect('/admin/rulesets/scoring');
}
