'use client';

import { type ReactNode } from 'react';
import { ModifiedBadge, ResetLink } from '@/components/ModifiedBadge';

/**
 * The "modified" badge and the Reset of a rules field: shown when its value is not the one the
 * ruleset starts a Tournament from at its pinned version (`start`, operator ruling 51), none
 * without a start value. Reset puts the start value back as it is. For the Match format tab and
 * the TF_v1 controls.
 */
export function startAffordance<T>(
  value: T,
  start: T | undefined,
  label: (start: T) => string,
  onChange: (v: T) => void,
): { badge: ReactNode; reset: ReactNode } {
  if (start === undefined || value === start) return { badge: null, reset: null };
  const startLabel = label(start);
  return {
    badge: <ModifiedBadge startLabel={startLabel} />,
    reset: <ResetLink startLabel={startLabel} onReset={() => onChange(start)} />,
  };
}
