import { redirect } from 'next/navigation';

// Slice C of the Rulesets unification (commit cb75f84+) relocated the
// scoring-systems page under /admin/rulesets/league. This stub keeps
// existing bookmarks + the old league-editor "Manage scoring systems →"
// link working until everywhere catches up.
export default function ScoringSystemsRedirect() {
  redirect('/admin/rulesets/league');
}
