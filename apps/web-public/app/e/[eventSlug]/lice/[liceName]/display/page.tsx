import { LiceDisplayClient } from './lice-display-client';

interface Props {
  params: Promise<{ eventSlug: string; liceName: string }>;
}

export default async function LiceDisplayPage({ params }: Props) {
  const { eventSlug, liceName } = await params;
  // No apiUrl prop: LiceDisplayClient is a client component and resolves
  // the browser-reachable API URL via getServerApiUrl() itself. Passing the
  // server-resolved (docker-internal) URL would be unreachable in the
  // browser.
  return <LiceDisplayClient eventSlug={eventSlug} liceName={liceName} />;
}
