'use client';

import { useId, useState, type ReactNode } from 'react';
import { ModifiedBadge, ResetLink } from '@/components/ModifiedBadge';

/**
 * The ruleset editor's fields: a name linked to its control by id, the "modified" badge and Reset
 * beside it (outside the `<label>`, so clicking the name never presses Reset), and the control.
 * The badge shows when the field differs from the engine; Reset makes it follow the engine again
 * (operator rulings 60 and 134). A disabled form shows the badge but offers no Reset.
 */
export interface Affordance {
  /** Whether the field differs from the engine. */
  modified?: boolean;
  /** The engine's value, as the field shows it. */
  engineLabel?: string;
  onReset?: () => void;
}

export function FieldHead({
  id,
  label,
  modified,
  engineLabel = '',
  onReset,
  disabled,
}: Affordance & { id: string; label: string; disabled?: boolean }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-foreground-secondary">
      <label htmlFor={id}>{label}</label>
      {modified && <ModifiedBadge startLabel={engineLabel} />}
      {modified && onReset && !disabled && (
        <span className="ml-auto">
          <ResetLink startLabel={engineLabel} onReset={onReset} />
        </span>
      )}
    </div>
  );
}

const INVALID = Symbol('invalid');

/** The typed text as a value: empty or refused is INVALID; on a nullable field 0 is null ("none"). */
function parseDraft(
  text: string,
  nullable: boolean,
  accepts: (value: number | null) => boolean,
): number | null | typeof INVALID {
  if (text.trim() === '') return INVALID;
  const n = Number(text);
  if (!Number.isFinite(n)) return INVALID;
  const value = nullable && n === 0 ? null : n;
  return accepts(value) ? value : INVALID;
}

interface NumberFieldProps extends Affordance {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  onValidity: (valid: boolean) => void;
  accepts: (value: number | null) => boolean;
  nullable?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
}

/** The typed text of a number field: what it shows, whether it is invalid, and a Reset clearing it. */
function useNumberDraft({
  onChange,
  onValidity,
  accepts,
  nullable = false,
  onReset,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseDraft(draft, nullable, accepts) === INVALID;

  function type(text: string) {
    setDraft(text);
    const parsed = parseDraft(text, nullable, accepts);
    onValidity(parsed !== INVALID);
    if (parsed !== INVALID) onChange(parsed);
  }

  // Reset clears the draft too, so the field shows the engine's value again.
  const reset = onReset
    ? () => {
        setDraft(null);
        onValidity(true);
        onReset();
      }
    : undefined;

  return { draft, invalid, type, reset };
}

/**
 * A number the author types. The field keeps the TEXT typed as its draft: an empty field, or a
 * value the engine refuses, is reported invalid and never reaches the ruleset (operator ruling 141:
 * an empty box is refused, a 0 on a nullable field means "none", a stored "none" shows 0).
 */
export function NumberField(props: NumberFieldProps) {
  const { label, value, disabled, min, max, modified, engineLabel } = props;
  const id = useId();
  const { draft, invalid, type, reset } = useNumberDraft(props);

  return (
    <div>
      <FieldHead
        id={id}
        label={label}
        disabled={disabled}
        modified={modified}
        engineLabel={engineLabel}
        onReset={reset}
      />
      <input
        id={id}
        type="number"
        value={draft ?? String(value ?? 0)}
        min={min}
        max={max}
        aria-invalid={invalid || undefined}
        onChange={(e) => type(e.target.value)}
        disabled={disabled}
        className={`mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm disabled:bg-background ${
          invalid ? 'border-danger' : 'border-border'
        }`}
      />
    </div>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  ...affordance
}: Affordance & {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <FieldHead id={id} label={label} disabled={disabled} {...affordance} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm disabled:bg-background"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The badge and Reset of a section with its own heading (the double-hit penalty). */
export function SectionAffordance({
  modified,
  engineLabel = '',
  onReset,
  disabled,
}: Affordance & { disabled?: boolean }): ReactNode {
  if (!modified) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-2 normal-case tracking-normal">
      <ModifiedBadge startLabel={engineLabel} />
      {onReset && !disabled && <ResetLink startLabel={engineLabel} onReset={onReset} />}
    </span>
  );
}
