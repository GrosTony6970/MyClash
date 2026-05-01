/**
 * Event home placeholder — T-604 will replace this.
 */

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export default async function EventPage({ params }: Props) {
  const { eventSlug } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <h1
        className="text-4xl font-bold mb-4"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary)' }}
      >
        {eventSlug}
      </h1>
      <p className="text-gray-400">Event home — T-604</p>
    </main>
  );
}
