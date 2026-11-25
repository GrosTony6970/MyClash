'use client';

import { useI18n } from '@myclash/next-i18n/client';
import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  TournamentColorDot,
} from '@myclash/ui';
import type { Team } from '../team-form';
import { TeamLogo } from './TeamLogoField';

interface TeamsTableProps {
  teams: Team[];
  /** The Event is archived: the server refuses every write, so no action is offered. */
  readOnly: boolean;
  onEdit: (team: Team) => void;
  onDelete: (team: Team) => void;
}

/** The teams of a Tournament: colour, logo, name, size, seed, and the row's two actions. */
export function TeamsTable({ teams, readOnly, onEdit, onDelete }: TeamsTableProps) {
  const { t } = useI18n();
  return (
    <DataTable>
      <DataTableHead>
        <DataTableCell as="th">{t('organizer.teams.colColor')}</DataTableCell>
        <DataTableCell as="th">{t('organizer.teams.colLogo')}</DataTableCell>
        <DataTableCell as="th">{t('organizer.teams.colName')}</DataTableCell>
        <DataTableCell as="th">{t('organizer.teams.colSize')}</DataTableCell>
        <DataTableCell as="th">{t('organizer.teams.colSeed')}</DataTableCell>
        {!readOnly && <DataTableCell as="th">{t('organizer.teams.colActions')}</DataTableCell>}
      </DataTableHead>
      <tbody>
        {teams.map((team) => (
          <DataTableRow key={team.id} data-testid="team-row">
            <DataTableCell>
              <TournamentColorDot color={team.color} />
            </DataTableCell>
            <DataTableCell>
              <TeamLogo
                url={team.logoUrl}
                name={team.name}
                className="h-8 w-8 rounded-full border border-border"
              />
            </DataTableCell>
            <DataTableCell className="font-semibold text-foreground">{team.name}</DataTableCell>
            <DataTableCell className="tabular-nums">{team.size}</DataTableCell>
            <DataTableCell className="tabular-nums">{team.seed ?? '—'}</DataTableCell>
            {!readOnly && (
              <DataTableCell>
                <RowActions onEdit={() => onEdit(team)} onDelete={() => onDelete(team)} />
              </DataTableCell>
            )}
          </DataTableRow>
        ))}
      </tbody>
    </DataTable>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
      >
        {t('actions.edit')}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"
      >
        {t('actions.delete')}
      </button>
    </span>
  );
}
