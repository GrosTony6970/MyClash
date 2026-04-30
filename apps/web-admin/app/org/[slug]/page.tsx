import type { Metadata } from 'next';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} — MyClash Admin` };
}

export default async function OrgDashboardPage({ params }: Props) {
  const { slug } = await params;

  return (
    <main className="flex min-h-screen flex-col p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Organization dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          <span className="font-mono text-gray-700">{slug}</span>
        </p>
      </header>

      {/* Empty state — events will be listed here in T-105+ */}
      <div className="flex flex-col items-center justify-center flex-1 text-center py-24 border-2 border-dashed border-gray-200 rounded-xl">
        <p className="text-4xl mb-4">🏆</p>
        <h2 className="text-xl font-semibold mb-2">Create your first event</h2>
        <p className="text-gray-500 max-w-sm mb-6">
          An event is the gathering — FAL 2026, Swordfish 2027. Inside it you create tournaments,
          workshops, and manage your roster.
        </p>
        <button
          disabled
          className="bg-red-700 text-white font-semibold py-2 px-6 rounded-md opacity-50 cursor-not-allowed"
          title="Coming in T-105"
        >
          New event
        </button>
        <p className="text-xs text-gray-400 mt-3">Event creation coming soon (T-105)</p>
      </div>
    </main>
  );
}
