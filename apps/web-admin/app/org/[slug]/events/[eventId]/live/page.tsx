import { LiveBoard } from './LiveBoard';

export default async function LivePage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;
  return <LiveBoard slug={slug} eventId={eventId} />;
}
