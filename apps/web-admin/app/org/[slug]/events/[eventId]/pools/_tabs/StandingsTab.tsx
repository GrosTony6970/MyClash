'use client';

export function StandingsTab({
  tournamentId,
  poolPhaseId,
}: {
  tournamentId: string;
  poolPhaseId: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
      Standings tab — under construction (tournament {tournamentId}, phase {poolPhaseId})
    </div>
  );
}
