'use client';

/**
 * One card per round: pairings, the bye, the engine's warnings, validity, and
 * the manual overrides.
 *
 * Swap is SELECT-THEN-SELECT rather than drag: two clicks, keyboard-operable by
 * default, which is what the a11y gate needs and what a venue laptop with a
 * trackpad wants at 8am. Set-sides — the escape hatch that can genuinely break a
 * round — sits behind an "advanced" toggle so it is not the obvious tool.
 *
 * A round is editable only while `pending`. That is not a new state: a round
 * becomes `running` when its first bout starts, which is exactly the override
 * window closing (decision 3).
 */

import { useState } from 'react';
import { t } from '@myclash/i18n';
import { ConfirmDialog, useToast } from '@myclash/ui';
import {
  swissMutate,
  type SwissAdminRound,
  type SwissOverrideWarning,
  type UseSwissAdmin,
} from '../useSwissAdmin';
import { RoundCard } from '../_components/RoundCard';

export function RoundsTab({
  swiss,
  isReadOnly,
}: {
  swiss: UseSwissAdmin;
  isReadOnly: boolean;
  slug: string;
  eventId: string;
}) {
  const toast = useToast();
  const { view, reload, nameOf } = swiss;
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<{ roundId: string; registrationId: string } | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<SwissAdminRound | null>(null);
  /** A 409 carrying warnings: the same swap, re-offered with confirm. */
  const [pendingSwap, setPendingSwap] = useState<{
    roundId: string;
    a: string;
    b: string;
    warnings: SwissOverrideWarning[];
  } | null>(null);

  if (!view || view.phaseId === null) {
    return <p className="text-sm text-muted">{t('organizer.swiss.rounds.noPhase')}</p>;
  }
  const finalized = Boolean(view.config?.finalized);
  const locked = isReadOnly || finalized;

  async function run(label: string, fn: () => ReturnType<typeof swissMutate>) {
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.message);
        return result;
      }
      toast.success(label);
      await reload();
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function swap(roundId: string, a: string, b: string, confirm: boolean) {
    setSelected(null);
    const result = await run(t('organizer.swiss.rounds.swapped'), () =>
      swissMutate(`/swiss-rounds/${roundId}/swap`, {
        method: 'POST',
        body: { aRegistrationId: a, bRegistrationId: b, confirm },
      }),
    );
    // 409 = the swap is legal but creates a rematch, a repeat bye or a same-club
    // pairing. Re-offer it rather than refusing: the organiser may well want it.
    if (!result.ok && result.status === 409 && !confirm) {
      setPendingSwap({ roundId, a, b, warnings: result.warnings });
    }
  }

  /** Click one fighter, then another in the SAME round, to exchange them. */
  function pick(roundId: string, registrationId: string) {
    if (!selected || selected.roundId !== roundId) {
      setSelected({ roundId, registrationId });
      return;
    }
    if (selected.registrationId === registrationId) {
      setSelected(null);
      return;
    }
    void swap(roundId, selected.registrationId, registrationId, false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {t('organizer.swiss.rounds.progress', {
            done: view.rounds.filter((round) => round.status === 'completed').length,
            total: view.config?.roundCount ?? view.rounds.length,
          })}
        </p>
        <label className="flex items-center gap-2 text-xs text-foreground-secondary">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => setAdvanced(e.target.checked)}
          />
          {t('organizer.swiss.rounds.advanced')}
        </label>
      </div>

      {finalized && (
        <div className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-muted">
          {t('organizer.swiss.rounds.finalisedBanner')}
        </div>
      )}

      {view.rounds.length === 0 && (
        <p className="text-sm text-muted">{t('organizer.swiss.rounds.empty')}</p>
      )}

      {view.rounds.map((round, index) => (
        <RoundCard
          key={round.id}
          round={round}
          nameOf={nameOf}
          locked={locked}
          busy={busy}
          advanced={advanced}
          selectedRegistrationId={selected?.roundId === round.id ? selected.registrationId : null}
          isLast={index === view.rounds.length - 1}
          onPick={(registrationId) => pick(round.id, registrationId)}
          onDelete={() => setPendingDelete(round)}
          onSetSides={(matchId, red, blue) =>
            void run(t('organizer.swiss.rounds.sidesSet'), () =>
              swissMutate(`/matches/${matchId}/swiss-sides`, {
                method: 'PATCH',
                body: { redRegistrationId: red, blueRegistrationId: blue, confirm: true },
              }),
            )
          }
        />
      ))}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('organizer.swiss.rounds.deleteTitle', {
          round: pendingDelete?.roundNumber ?? 0,
        })}
        description={t('organizer.swiss.rounds.deleteBody', {
          count: pendingDelete?.matches.length ?? 0,
        })}
        confirmLabel={t('organizer.swiss.rounds.deleteConfirm')}
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const round = pendingDelete;
          setPendingDelete(null);
          if (!round) return;
          void run(t('organizer.swiss.rounds.deleted'), () =>
            swissMutate(`/swiss-phases/${view.phaseId}/rounds/${round.roundNumber}`, {
              method: 'DELETE',
            }),
          );
        }}
      />

      <ConfirmDialog
        open={pendingSwap !== null}
        title={t('organizer.swiss.rounds.swapWarningTitle')}
        // The WHY, not just "needs confirmation": the engine already said which
        // rule this breaks, and asking someone to confirm an unnamed warning is
        // how a rematch gets waved through.
        description={(pendingSwap?.warnings ?? [])
          .map((warning) =>
            t(`organizer.swiss.rounds.swapWarning.${warning.code}`, {
              fighters: warning.registrationIds.map((id) => nameOf(id)).join(' / '),
            }),
          )
          .join(' ')}
        confirmLabel={t('organizer.swiss.rounds.swapWarningConfirm')}
        busy={busy}
        onCancel={() => setPendingSwap(null)}
        onConfirm={() => {
          const request = pendingSwap;
          setPendingSwap(null);
          if (request) void swap(request.roundId, request.a, request.b, true);
        }}
      />
    </div>
  );
}
