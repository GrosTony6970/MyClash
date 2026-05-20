'use client';

export function Step4Advanced({
  onBack,
  onFinish,
}: {
  tournamentId: string;
  onBack: () => void;
  onFinish: (publish: boolean) => void;
}) {
  return (
    <div>
      <p className="text-sm text-slate-500">Step 4 — Advanced (stub)</p>
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
          onClick={() => onFinish(false)}
          className="rounded bg-red-800 text-white px-3 py-1 text-sm"
        >
          Finish
        </button>
      </div>
    </div>
  );
}
