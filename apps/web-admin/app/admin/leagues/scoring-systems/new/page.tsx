import { redirect } from 'next/navigation';

export default function ScoringSystemsNewRedirect() {
  redirect('/admin/rulesets/league/new');
}
