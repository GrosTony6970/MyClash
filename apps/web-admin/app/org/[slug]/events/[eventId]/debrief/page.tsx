import { PostEventReport } from './PostEventReport';

export default async function DebriefPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;
  return <PostEventReport slug={slug} eventId={eventId} />;
}
