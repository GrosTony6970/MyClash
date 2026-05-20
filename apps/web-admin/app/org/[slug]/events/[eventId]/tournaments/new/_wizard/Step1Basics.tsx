'use client';

export function Step1Basics({
  onCreated,
}: {
  eventId: string;
  initialTournamentId: string | null;
  onCreated: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-sm text-slate-500">Step 1 — Basics (stub)</p>
      <button
        type="button"
        onClick={() => onCreated('stub-id')}
        className="mt-2 rounded bg-red-800 text-white px-3 py-1 text-sm"
      >
        Next
      </button>
    </div>
  );
}
