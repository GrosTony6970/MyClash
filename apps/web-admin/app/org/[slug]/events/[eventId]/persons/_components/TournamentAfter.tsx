/**
 * "— Longsword Open" after a numbered bout in the remove-a-fighter window. A bout with no
 * number is named by its Tournament already (`boutName`), so it gets nothing here.
 */
export function TournamentAfter({
  bout,
  separator,
}: {
  bout: { label?: string; tournamentName: string };
  separator: string;
}) {
  if (!bout.label) return null;
  return (
    <>
      {' '}
      {separator} <span className="italic">{bout.tournamentName}</span>
    </>
  );
}
