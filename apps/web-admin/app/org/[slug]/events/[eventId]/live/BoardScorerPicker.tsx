'use client';
import { useState } from 'react';
import { useToast } from '@myclash/ui';
import type { Translator } from '@myclash/next-i18n/client';
import type { LiveBoardAccount } from '@/lib/live-board/types';

type T = Translator;

const NONE = '__none__';

/**
 * Names worth reporting after a reassignment.
 *
 * Excludes the scorer being replaced — the organizer just did that on purpose
 * and does not need telling. What matters is a co-scorer they did not know was
 * there.
 */
function displacedNames(
  removedIds: string[],
  currentAccountId: string | null,
  accounts: LiveBoardAccount[],
): string[] {
  return removedIds
    .filter((id) => id !== currentAccountId)
    .map((id) => accounts.find((a) => a.accountId === id)?.name)
    .filter((n): n is string => Boolean(n));
}

/**
 * Put a different scorer on this piste, from the board.
 *
 * This reverses v1's "no destructive edits on the board" rule, deliberately:
 * the organizer who has just seen a piste go amber is standing at the board,
 * and sending them to the staff page to fix it means losing the board at the
 * exact moment they need it.
 *
 * It lives inside the row expansion rather than in a popover on the collapsed
 * row, matching the rule the expansion already sets: the row shows state, the
 * expansion is where you act. That also keeps one interactive control per row
 * in the collapsed view, which the overlay click target depends on.
 */
interface PickerProps {
  liceId: string;
  currentAccountId: string | null;
  accounts: LiveBoardAccount[];
  onAssign: (liceId: string, staffAccountId: string | null) => Promise<string[]>;
  t: T;
}

export function BoardScorerPicker({
  liceId,
  currentAccountId,
  accounts,
  onAssign,
  t,
}: PickerProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Disabled accounts cannot score, so offering them is offering a dead end.
  const options = accounts.filter((a) => a.status === 'active');

  async function assign(value: string) {
    setBusy(true);
    try {
      const removed = await onAssign(liceId, value === NONE ? null : value);
      const names = displacedNames(removed, currentAccountId, accounts);
      // Replacing the piste's assignments drops any co-scorer the staff page
      // set. Say so — silently discarding another organizer's setup is the
      // failure mode this whole endpoint was designed around.
      if (names.length > 0) {
        toast.info(t('organizer.live.reassign.removed', { names: names.join(', ') }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted">{t('organizer.live.reassign.label')}</span>
      <select
        value={currentAccountId ?? NONE}
        disabled={busy}
        onChange={(e) => void assign(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground disabled:opacity-50"
      >
        {options.map((a) => (
          <option key={a.accountId} value={a.accountId}>
            {optionLabel(a, currentAccountId, t)}
          </option>
        ))}
        {/* Last, and always present: clearing a piste is a real operation
            (a strip going dark over lunch), not an empty state. */}
        <option value={NONE}>{t('organizer.live.reassign.none')}</option>
      </select>
    </label>
  );
}

/** Flags a candidate who is already covering other pistes. */
function optionLabel(account: LiveBoardAccount, currentAccountId: string | null, t: T): string {
  const elsewhere = account.liceIds.length > 0 && account.accountId !== currentAccountId;
  return elsewhere
    ? `${account.name} — ${t('organizer.live.reassign.alreadyOn', { count: account.liceIds.length })}`
    : account.name;
}
