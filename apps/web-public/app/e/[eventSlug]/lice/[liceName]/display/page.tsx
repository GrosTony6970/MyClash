import { LiceDisplayClient } from './lice-display-client';
import { getApiUrl } from '@/lib/api-url';

const API_URL = getApiUrl();

interface Props {
  params: Promise<{ eventSlug: string; liceName: string }>;
}

export default async function LiceDisplayPage({ params }: Props) {
  const { eventSlug, liceName } = await params;
  return <LiceDisplayClient apiUrl={API_URL} eventSlug={eventSlug} liceName={liceName} />;
}
