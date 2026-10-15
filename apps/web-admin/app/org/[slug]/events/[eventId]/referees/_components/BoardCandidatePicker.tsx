'use client';

/**
 * The picker as every referee board opens it: the Event's referee board and the Pools,
 * bracket and Swiss tabs. ONE owner of what a pick does there (quick win O8): it sends
 * one assignment at a time, shows a refusal INSIDE the picker (it used to land on the
 * page, behind the picker's backdrop), and closes once the assignment is saved. A new
 * picker starts with no refusal: each one is mounted when it opens.
 */

import { useRef, useState } from 'react';
import { CandidatePicker } from './CandidatePicker';
import type {
  AssignAnswer,
  AssignmentBoardPool,
  AssignmentBoardRoleSlot,
} from './useAssignmentBoard';

export interface PickerTarget {
  pool: Pick<AssignmentBoardPool, 'id' | 'name' | 'tournamentName'>;
  slot: AssignmentBoardRoleSlot;
}

interface BoardPickerProps {
  target: PickerTarget;
  manualAssign: (
    poolId: string,
    role: string,
    personId: string,
    confirm: boolean,
  ) => Promise<AssignAnswer>;
  /** The board itself is saving something else. */
  busy: boolean;
  /** The Event's names of its referee skills, to name the slot. */
  skillNameById: ReadonlyMap<string, string>;
  onClose: () => void;
}

export function BoardCandidatePicker({
  target,
  manualAssign,
  busy,
  skillNameById,
  onClose,
}: BoardPickerProps) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A second click lands before the render that turns the buttons off.
  const out = useRef(false);

  async function assign(personId: string, confirm: boolean) {
    if (out.current) return;
    out.current = true;
    setSending(true);
    setRefusal(null);
    try {
      const answer = await manualAssign(target.pool.id, target.slot.role, personId, confirm);
      if (answer.assigned) onClose();
      else setRefusal(answer.refusal);
    } finally {
      out.current = false;
      setSending(false);
    }
  }

  return (
    <CandidatePicker
      pool={target.pool}
      slot={target.slot}
      skillNameById={skillNameById}
      refusal={refusal}
      busy={busy || sending}
      onAssign={(personId, confirm) => void assign(personId, confirm)}
      onCancel={onClose}
    />
  );
}
