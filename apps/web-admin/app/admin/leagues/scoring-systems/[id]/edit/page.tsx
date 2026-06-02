import { redirect } from 'next/navigation';

export default async function ScoringSystemsEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/rulesets/league/${id}/edit`);
}
