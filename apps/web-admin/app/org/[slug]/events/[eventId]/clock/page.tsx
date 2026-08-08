import { ClockReport } from './ClockReport';

export default async function ClockReportPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;
  return <ClockReport slug={slug} eventId={eventId} />;
}
