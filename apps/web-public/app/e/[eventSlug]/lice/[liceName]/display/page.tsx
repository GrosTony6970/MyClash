import { LiceDisplayClient } from './lice-display-client';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface Props {
  params: Promise<{ eventSlug: string; liceName: string }>;
}

export default async function LiceDisplayPage({ params }: Props) {
  const { eventSlug, liceName } = await params;
  return <LiceDisplayClient apiUrl={API_URL} eventSlug={eventSlug} liceName={liceName} />;
}
