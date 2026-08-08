import { StartOfDay } from './StartOfDay';

export default async function StartOfDayPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;
  return <StartOfDay slug={slug} eventId={eventId} />;
}
