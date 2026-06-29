'use client';

import { Button } from '@myclash/ui';
import type { ReactNode } from 'react';

export interface WorkshopSessionCardLabels {
  register: string;
  registerAnyway: string;
  cancel: string;
  registered: string;
  joinWaitlist: string;
  full: string;
}

export interface WorkshopSessionCardProps {
  title: string;
  timeLabel: string;
  enrolled: boolean;
  full: boolean;
  spotsLabel?: string | null;
  conflict?: string | null;
  busy?: boolean;
  labels: WorkshopSessionCardLabels;
  onRegister?: () => void;
  onCancel?: () => void;
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function WorkshopSessionCard({
  title,
  timeLabel,
  enrolled,
  full,
  spotsLabel,
  conflict,
  busy,
  labels,
  onRegister,
  onCancel,
}: WorkshopSessionCardProps): ReactNode {
  return (
    <div
      className={[
        'rounded-xl border bg-surface p-4',
        enrolled ? 'border-success/40 bg-success/5' : 'border-border',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-bold leading-tight">{title}</p>
        {enrolled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {labels.registered}
          </span>
        ) : full ? (
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-bold text-muted">
            {labels.full}
          </span>
        ) : spotsLabel ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700">
            {spotsLabel}
          </span>
        ) : null}
      </div>

      <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted">
        <ClockIcon />
        {timeLabel}
      </p>

      {conflict && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2 py-1.5 text-xs font-semibold text-danger">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          {conflict}
        </p>
      )}

      <div className="mt-3">
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
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            loading={busy}
            onClick={onRegister}
          >
            {labels.register}
          </Button>
        )}
      </div>
    </div>
  );
}
