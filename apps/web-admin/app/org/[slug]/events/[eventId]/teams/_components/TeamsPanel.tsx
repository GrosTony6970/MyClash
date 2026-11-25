'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { Button, EmptyState, useConfirm } from '@myclash/ui';
import { useState } from 'react';
import { PageAlert, errorOutcome, successOutcome, type Outcome } from '@/components/PageAlert';
import {
  createBody,
  updateBody,
  type Team,
  type TeamForm,
  type TeamTournament,
} from '../team-form';
import { teamRefusal } from '../team-refusal';
import { useTeams, type TeamWrite } from '../useTeams';
import { TeamDialog } from './TeamDialog';
import { TeamsTable } from './TeamsTable';

/**
 * The writes of the Teams panel and what each came to: a save from the dialog (which keeps its own
 * refusal), and a delete asked first (whose answer is the page's).
 */
function useTeamActions(tournamentId: string) {
  const { t } = useI18n();
  const teams = useTeams(tournamentId);
  const { confirm, confirmDialog } = useConfirm();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function submit(edited: Team | null, form: TeamForm): Promise<TeamWrite> {
    const done = edited
      ? await teams.update(edited.id, updateBody(form))
      : await teams.create(createBody(form));
    const saved = edited ? t('organizer.teams.saved') : t('organizer.teams.created');
    if (done.ok) setOutcome(successOutcome(saved));
    return done;
  }

  async function remove(team: Team) {
    const sure = await confirm({
      title: t('organizer.teams.deleteTitle', { name: team.name }),
      description: t('organizer.teams.deleteBody'),
      confirmLabel: t('organizer.teams.deleteYes'),
      cancelLabel: t('actions.cancel'),
      danger: true,
    });
    if (!sure) return;
    const done = await teams.remove(team.id);
    const refused = done.ok ? null : teamRefusal(done.failure, t, t('organizer.teams.deleteError'));
    setOutcome(refused ? errorOutcome(refused) : successOutcome(t('organizer.teams.deleted')));
  }

  const loadError = teams.loadFailure
    ? teamRefusal(teams.loadFailure, t, t('organizer.teams.loadError'))
    : null;
  return {
    teams,
    submit,
    remove,
    confirmDialog,
    outcome: loadError ? errorOutcome(loadError) : outcome,
  };
}

/** One team Tournament's teams: the table, Add, and each row's Edit and Delete. */
export function TeamsPanel(props: { tournament: TeamTournament; readOnly: boolean }) {
  const { tournament, readOnly } = props;
  const { t } = useI18n();
  const actions = useTeamActions(tournament.id);
  const { teams } = actions;
  // The dialog open: a new team (id null), or the team edited, read from the list each render.
  const [editing, setEditing] = useState<{ teamId: string | null } | null>(null);
  const edited = teams.teams.find((team) => team.id === editing?.teamId) ?? null;
  const refusalOf = (write: TeamWrite) =>
    write.ok ? null : teamRefusal(write.failure, t, t('organizer.teams.saveError'));
  const empty = !teams.loading && teams.teams.length === 0 && !teams.loadFailure;
  return (
    <section className="space-y-4">
      <PageAlert outcome={actions.outcome} />
      {!readOnly && (
        <Button size="sm" onClick={() => setEditing({ teamId: null })}>
          {t('organizer.teams.add')}
        </Button>
      )}
      {empty ? (
        <EmptyState
          title={t('organizer.teams.empty')}
          description={t('organizer.teams.emptyHint')}
        />
      ) : (
        <TeamsTable
          teams={teams.teams}
          readOnly={readOnly}
          onEdit={(team) => setEditing({ teamId: team.id })}
          onDelete={(team) => void actions.remove(team)}
        />
      )}
      {editing && (editing.teamId === null || edited) && (
        <TeamDialog
          key={editing.teamId ?? 'new'}
          team={edited}
          defaultSize={tournament.teamDefaultSize}
          onClose={() => setEditing(null)}
          onSubmit={(form) => actions.submit(edited, form)}
          onLogo={edited ? teams.logoOf(edited.id) : undefined}
          refusalOf={refusalOf}
        />
      )}
      {actions.confirmDialog}
    </section>
  );
}
