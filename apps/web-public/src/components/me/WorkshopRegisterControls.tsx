'use client';

import { Button } from '@myclash/ui';
import type { ReactNode } from 'react';

export interface WorkshopRegisterLabels {
  register: string;
  registerAnyway: string;
  cancel: string;
  registered: string;
  joinWaitlist: string;
  full: string;
}

export interface WorkshopRegisterControlsProps {
  enrolled: boolean;
  full: boolean;
  conflict?: string | null;
  busy?: boolean;
  labels: WorkshopRegisterLabels;
  onRegister?: () => void;
  onCancel?: () => void;
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * Registration footer for a personal-space workshop card: the warn-but-allow
 * conflict badge, the enrolled chip, and the four-state action button
 * (Register / Register-anyway / Join-waitlist / Cancel). Slotted into the shared
 * `WorkshopCard` footer.
 */
export function WorkshopRegisterControls({
  enrolled,
  full,
  conflict,
  busy,
  labels,
  onRegister,
  onCancel,
}: WorkshopRegisterControlsProps): ReactNode {
  return (
    <div>
      {conflict && !enrolled && (
        <p className="mb-2.5 inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2 py-1.5 text-xs font-semibold text-danger">
          <WarningIcon />
          {conflict}
        </p>
      )}
      {enrolled && (
        <p className="mb-2.5 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
          <CheckIcon />
          {labels.registered}
        </p>
      )}

      {enrolled ? (
        <Button variant="danger" size="sm" className="w-full" loading={busy} onClick={onCancel}>
          {labels.cancel}
        </Button>
      ) : full ? (
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          loading={busy}
          onClick={onRegister}
        >
          {labels.joinWaitlist}
        </Button>
      ) : conflict ? (
        <Button
          variant="secondary"
          size="sm"
          className="w-full border-danger/50 text-danger"
          loading={busy}
          onClick={onRegister}
        >
          {labels.registerAnyway}
        </Button>
      ) : (
        <Button variant="primary" size="sm" className="w-full" loading={busy} onClick={onRegister}>
          {labels.register}
        </Button>
      )}
    </div>
  );
}
