'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { Modal, statusLabel } from '@myclash/ui';
import { rulesChangeLines, type RulesChange } from '@myclash/types';
import type { MovedFighter } from '@/lib/rules-change-refusal';
import { ConfirmFields, ConfirmFooter, useConfirmWords } from './RulesConfirm';
import type {
  FollowReport,
  NamedFighter,
  RulesChangeDialogState,
  RulesHost,
} from './useRulesChangeDialog';

type T = (key: string, values?: Record<string, string | number>) => string;

const BOX = 'space-y-2 rounded-md border border-border bg-surface p-4';
const HEADING = 'text-xs font-medium text-foreground-secondary';
const LIST = 'list-disc space-y-1 pl-5 text-sm text-foreground';

/**
 * The dialog of a settings change the lock refused (the audited settings change, commit 5c;
 * rulings 162-169). It lists every change of the save in its order, a locked one tagged, then the
 * Fighters the change moves in the API's order, by name and in the roster's status words; it asks
 * for a reason and the typed name (`RulesConfirm.tsx`, shared with the re-pin). After the save it
 * shows what did not follow, problems first, until Close. The tab mounts it while a refusal is
 * held; `host` is built when the organiser confirms, so it carries the tab's rules of that moment.
 */
export function RulesChangeDialog<S>(props: {
  dialog: RulesChangeDialogState<S>;
  tournamentName: string;
  host: () => RulesHost<S>;
}) {
  const { dialog } = props;
  if (!dialog.refused) return null;
  return dialog.result ? (
    <ResultView report={dialog.result} onClose={dialog.close} />
  ) : (
    <ConfirmView {...props} />
  );
}

function ConfirmView<S>({
  dialog,
  tournamentName,
  host,
}: Parameters<typeof RulesChangeDialog<S>>[0]) {
  const { t } = useI18n();
  const fields = useConfirmWords(tournamentName);
  const { changes, fighters } = dialog.refused!;
  return (
    <Modal
      open
      onClose={dialog.close}
      busy={dialog.busy}
      size="lg"
      title={t('admin.rulesChange.settingsTitle')}
      footer={
        <ConfirmFooter
          busy={dialog.busy}
          valid={fields.valid}
          label={t('admin.rulesChange.confirm')}
          onConfirm={() => void dialog.confirm(fields.words(), host())}
          onClose={dialog.close}
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground-secondary">
          {t('admin.rulesChange.settingsIntro')}
          {fighters.length > 0 ? ` ${t('admin.rulesChange.fightersIntro')}` : null}
        </p>
        <ChangeList changes={changes} t={t} />
        {fighters.length > 0 && <FighterList fighters={fighters} t={t} />}
        <ConfirmFields
          fields={fields}
          placeholder={t('admin.rulesChange.reasonPlaceholder')}
          tournamentName={tournamentName}
          error={dialog.error}
        />
      </div>
    </Modal>
  );
}

/** Each change in the save's order, one line each; a line whose change locked is tagged. */
function ChangeList({ changes, t }: { changes: readonly RulesChange[]; t: T }) {
  const lines = new Map<string, boolean>();
  for (const change of changes) {
    const line = rulesChangeLines([change], t)[0]!;
    lines.set(line, (lines.get(line) ?? false) || change.locked === true);
  }
  return (
    <div className={BOX}>
      <h3 className={HEADING}>{t('admin.rulesChange.changesHeading')}</h3>
      <ul className={LIST}>
        {[...lines].map(([line, locked]) => (
          <li key={line}>
            <span>{line}</span>
            {locked && (
              <span className="ml-2 rounded border border-warning/40 px-1.5 text-xs text-warning">
                {t('admin.rulesChange.locked')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Fighters the change moves, in the API's order (ruling 163). */
function FighterList({ fighters, t }: { fighters: readonly MovedFighter[]; t: T }) {
  const status = (value: string) => statusLabel('registration', value, t);
  return (
    <div className={BOX}>
      <h3 className={HEADING}>{t('admin.rulesChange.fightersHeading')}</h3>
      <ul className={LIST}>
        {fighters.map((f) => (
          <li key={f.registrationId}>
            {t('admin.rulesChange.fighterLine', {
              name: f.name,
              before: status(f.before),
              after: status(f.after),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the save says after it is written, problems first (rulings 144, 166), until Close. */
function ResultView({ report, onClose }: { report: FollowReport; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('admin.rulesChange.saved')}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover"
        >
          {t('admin.rulesChange.close')}
        </button>
      }
    >
      <div className="space-y-4 text-sm text-foreground">
        <Names heading="admin.rulesChange.notSettledHeading" fighters={report.notSettled} t={t} />
        {report.handOffFailed && (
          <p className="text-warning">{t('admin.rulesChange.handOffFailed')}</p>
        )}
        {report.followFailed && (
          <p className="text-warning">{t('admin.rulesChange.followFailed')}</p>
        )}
        <Names heading="admin.rulesChange.inStepHeading" fighters={report.inStep} t={t} />
      </div>
    </Modal>
  );
}

/** A heading and its Fighters by name; nothing when there are none. Never an id. */
function Names({
  heading,
  fighters,
  t,
}: {
  heading: 'admin.rulesChange.notSettledHeading' | 'admin.rulesChange.inStepHeading';
  fighters: readonly NamedFighter[];
  t: T;
}) {
  if (fighters.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className={HEADING}>{t(heading)}</h3>
      <ul className={LIST}>
        {fighters.map((f) => (
          <li key={f.registrationId}>{f.name ?? t('admin.rulesChange.unnamed')}</li>
        ))}
      </ul>
    </div>
  );
}
