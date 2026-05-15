import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export default async function EventPage({ params }: Props) {
  const { eventSlug } = await params;
  redirect(`/e/${eventSlug}/home`);
}
