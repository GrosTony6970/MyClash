'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { Button, Modal } from '@myclash/ui';
import { useState } from 'react';
import { PageAlert, errorOutcome } from '@/components/PageAlert';
import { formOf, type Team, type TeamForm } from '../team-form';
import type { TeamWrite } from '../useTeams';
import { SeatList, TeamFields } from './TeamFields';
import { TeamLogoField } from './TeamLogoField';

interface TeamDialogProps {
  /** The team to edit, as the list now holds it; null for a new one. */
  team: Team | null;
  /** The Tournament's default team size: a new team's size starts there. */
  defaultSize: number | null;
  onClose: () => void;
  /** Sends the form; the dialog closes once it is taken. */
  onSubmit: (form: TeamForm) => Promise<TeamWrite>;
  /** An existing team's logo writes; none for a new team, which takes its logo once it exists. */
  onLogo:
    { upload: (file: File) => Promise<TeamWrite>; remove: () => Promise<TeamWrite> } | undefined;
  /** Words a refused write. */
  refusalOf: (write: TeamWrite) => string | null;
}

/**
 * Create or edit a team: name, size, colour, seed, its numbered seats, and an existing team's logo.
 * A refusal stays in the dialog, in words, with the form as typed.
 */
export function TeamDialog(props: TeamDialogProps) {
  const { team, defaultSize, onClose, onSubmit, onLogo, refusalOf } = props;
  const { t } = useI18n();
  const [form, setForm] = useState<TeamForm>(() => formOf(team, defaultSize));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    const done = await onSubmit(form);
    setBusy(false);
    if (done.ok) onClose();
    else setRefusal(refusalOf(done));
  }

  const footer = (
    <>
      <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
        {t('actions.cancel')}
      </Button>
      <Button size="sm" onClick={() => void submit()} disabled={busy || !form.name.trim()}>
        {team ? t('actions.save') : t('actions.add')}
      </Button>
    </>
  );
  const title = team
    ? t('organizer.teams.editTitle', { name: team.name })
    : t('organizer.teams.createTitle');
  return (
    <Modal open onClose={onClose} busy={busy} title={title} footer={footer}>
      <div className="space-y-4">
        <TeamFields form={form} onChange={setForm} />
        <SeatList size={form.size} />
        {team && onLogo && (
          <TeamLogoField
            name={team.name}
            logoUrl={team.logoUrl}
            readOnly={busy}
            onUpload={onLogo.upload}
            onRemove={onLogo.remove}
            onRefused={(r) => setRefusal(typeof r === 'string' ? t(r) : refusalOf(r))}
          />
        )}
        <PageAlert outcome={refusal ? errorOutcome(refusal) : null} />
      </div>
    </Modal>
  );
}
