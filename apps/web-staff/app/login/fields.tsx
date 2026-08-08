'use client';

/**
 * The login page's field chrome, in one place.
 *
 * Four inputs across two auth flows repeated the same eleven-class string and
 * the same label/input pair. One copy means the focus ring and the touch target
 * cannot drift between the organiser's email field and a volunteer's PIN — and
 * the volunteer's is the one being typed on a borrowed tablet in a noisy hall.
 */
export const FIELD_CLASS =
  'w-full bg-surface border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent';

interface LabelledInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: 'numeric';
  autoComplete?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
}

/** A required text input with its label. Every field on this page is required. */
export function LabelledInput({
  id,
  label,
  value,
  onChange,
  type,
  placeholder,
  inputMode,
  autoComplete,
  inputRef,
  className,
}: LabelledInputProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground-secondary mb-1">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        required
        value={value}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={className ? `${className} ${FIELD_CLASS}` : FIELD_CLASS}
      />
    </div>
  );
}

/** The full-width primary action shared by both sign-in forms. */
export function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-bold py-3 px-4 rounded-lg transition-colors text-lg"
    >
      {label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-danger" role="alert">
      {message}
    </p>
  );
}
