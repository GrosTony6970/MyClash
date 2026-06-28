'use client';

export interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Accessible name when there is no associated visible <label>. */
  ariaLabel?: string;
  id?: string;
}

/**
 * Switch — tokenized on/off toggle. Accent track when on, border track when
 * off, surface-coloured knob. Shared promotion of the admin "Toggle" pattern
 * so boolean settings render consistently.
 */
export function Switch({ checked, onChange, disabled, ariaLabel, id }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 ring-accent focus:ring-offset-1 disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}
