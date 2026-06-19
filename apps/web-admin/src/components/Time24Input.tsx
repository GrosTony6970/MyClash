'use client';

import { useState } from 'react';
import { normalizeTime24 } from './time24';

interface Props {
  /** Canonical `HH:MM` (24h), or '' when empty. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * 24-hour time input. Renders a plain text field (never AM/PM, unlike
 * native `type="time"` which follows the OS locale). The operator can type
 * "9", "9:5", "0900"… and on blur it snaps to canonical `HH:MM` via
 * {@link normalizeTime24}; invalid text reverts to the last good value.
 */
export function Time24Input({ value, onChange, disabled, id, className, ...aria }: Props) {
  const [text, setText] = useState(value);
  // Re-sync the field when the parent value changes (e.g. prefill on edit) —
  // the "adjust state during render" pattern, no effect needed.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }

  function commit() {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (value !== '') onChange('');
      setText('');
      return;
    }
    const normalized = normalizeTime24(trimmed);
    if (normalized) {
      setText(normalized);
      if (normalized !== value) onChange(normalized);
    } else {
      setText(value); // revert invalid input
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder="HH:MM"
      id={id}
      aria-label={aria['aria-label']}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className={
        className ??
        'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600'
      }
    />
  );
}
