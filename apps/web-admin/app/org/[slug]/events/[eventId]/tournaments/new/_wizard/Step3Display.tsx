'use client';

export function Step3Display({
  onNext,
  onBack,
}: {
  tournamentId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <p className="text-sm text-slate-500">Step 3 — Display (stub)</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-slate-300 text-slate-700 px-3 py-1 text-sm"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded bg-red-800 text-white px-3 py-1 text-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}
