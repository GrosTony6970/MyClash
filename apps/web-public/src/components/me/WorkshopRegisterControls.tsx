'use client';

import { Button } from '@myclash/ui';
import type { ReactNode } from 'react';
import type { WorkshopBooking } from './workshop-booking';

export interface WorkshopRegisterLabels {
  register: string;
  registerAnyway: string;
  cancel: string;
  registered: string;
  joinWaitlist: string;
  /** The chip of a place on the waitlist, and the button that gives it up. */
  onWaitlist: string;
  leaveWaitlist: string;
  /** The sentence a refused viewer reads, and the button that books them again. */
  refused: string;
  registerAgain: string;
  full: string;
  /** Shown on the disabled button when the viewer teaches this workshop. */
  instructorOwn: string;
}

/** The words of the register controls, in the reader's language. */
export function registerLabels(t: (key: string) => string): WorkshopRegisterLabels {
  return {
    register: t('publicApp.me.workshops.register'),
    registerAnyway: t('publicApp.me.workshops.registerAnyway'),
    cancel: t('publicApp.me.workshops.cancel'),
    registered: t('publicApp.me.workshops.registered'),
    joinWaitlist: t('publicApp.me.workshops.joinWaitlist'),
    onWaitlist: t('publicApp.me.workshops.onWaitlist'),
    leaveWaitlist: t('publicApp.me.workshops.leaveWaitlist'),
    refused: t('publicApp.me.workshops.refused'),
    registerAgain: t('publicApp.me.workshops.registerAgain'),
    full: t('publicApp.me.workshops.full'),
    instructorOwn: t('publicApp.me.workshops.instructorOwn'),
  };
}

export interface WorkshopRegisterControlsProps {
  /** What the viewer's booking of this session is. */
  booking: WorkshopBooking;
  full: boolean;
  conflict?: string | null;
  busy?: boolean;
  /** The viewer teaches this workshop — no participant seat, button disabled. */
  isInstructor?: boolean;
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

/** What the viewer's booking is, said above the button. Nothing when there is none. */
function BookingNotice({
  booking,
  labels,
}: {
  booking: WorkshopBooking;
  labels: WorkshopRegisterLabels;
}): ReactNode {
  if (booking === 'confirmed') {
    return (
      <p className="mb-2.5 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
        <CheckIcon />
        {labels.registered}
      </p>
    );
  }
  if (booking === 'waitlisted') {
    return (
      <p className="mb-2.5 inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">
        {labels.onWaitlist}
      </p>
    );
  }
  if (booking === 'refused') {
    return <p className="mb-2.5 text-xs font-semibold text-muted">{labels.refused}</p>;
  }
  return null;
}

/**
 * Registration footer for a personal-space workshop card: the warn-but-allow
 * conflict badge, the chip of the viewer's booking, and the action button
 * (Register / Register-anyway / Join-waitlist / Cancel / Leave-waitlist /
 * Register-again). Slotted into the shared `WorkshopCard` footer.
 *
 * A seat says "Registered"; a place on the waitlist says so and can be given up
 * (ruling 235); a refusal is told, with one button that books again (ruling 236).
 *
 * `isInstructor` disables the button: someone who teaches the workshop takes no
 * participant seat, so the conflict badge is meaningless too. The API enforces
 * the same rule. The one exception is a seat that predates the rule — teaching
 * AND enrolled still gets its Cancel button, so the seat can be released here
 * rather than only from the instructor roster.
 */
export function WorkshopRegisterControls({
  booking,
  full,
  conflict,
  busy,
  isInstructor = false,
  labels,
  onRegister,
  onCancel,
}: WorkshopRegisterControlsProps): ReactNode {
  const booked = booking === 'confirmed' || booking === 'waitlisted';
  if (isInstructor && !booked) {
    return (
      <div>
        <Button variant="secondary" size="sm" className="w-full" disabled>
          {labels.instructorOwn}
        </Button>
      </div>
    );
  }

  return (
    <div>
      {conflict && !booked && (
        <p className="mb-2.5 inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2 py-1.5 text-xs font-semibold text-danger">
          <WarningIcon />
          {conflict}
        </p>
      )}
      <BookingNotice booking={booking} labels={labels} />

      {booked ? (
        <Button variant="danger" size="sm" className="w-full" loading={busy} onClick={onCancel}>
          {booking === 'waitlisted' ? labels.leaveWaitlist : labels.cancel}
        </Button>
      ) : booking === 'refused' ? (
        <Button variant="primary" size="sm" className="w-full" loading={busy} onClick={onRegister}>
          {labels.registerAgain}
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
