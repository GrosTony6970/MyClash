'use client';

/**
 * Slice 8 — referee availability chip list.
 *
 * Renders one toggle chip per option (tournament or day). Click to flip;
 * when the selection covers every option the row collapses to a single
 * compact "All" pill so the table doesn't get visually noisy when
 * everyone is available everywhere (the default).
 */

interface Option<TValue extends string | number> {
  value: TValue;
  label: string;
}

interface Props<TValue extends string | number> {
  options: Option<TValue>[];
  selected: TValue[];
  disabled?: boolean;
  allLabel: string;
  onChange: (next: TValue[]) => void;
}

export function AvailabilityChips<TValue extends string | number>({
  options,
  selected,
  disabled,
  allLabel,
  onChange,
}: Props<TValue>) {
  if (options.length === 0) {
    return <span className="text-xs italic text-slate-400">—</span>;
  }
  const selectedSet = new Set(selected);
  const allSelected = options.length > 0 && options.every((o) => selectedSet.has(o.value));

  function toggle(value: TValue) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function selectAll() {
    onChange(options.map((o) => o.value));
  }

  function clearAll() {
    onChange([]);
  }

  if (allSelected) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={clearAll}
        title={allLabel}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 disabled:opacity-50"
      >
        ✓ {allLabel}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {options.map((o) => {
        const on = selectedSet.has(o.value);
        return (
          <button
            type="button"
            key={String(o.value)}
            disabled={disabled}
            onClick={() => toggle(o.value)}
            className={[
              'rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
              on
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          disabled={disabled}
          onClick={selectAll}
          className="ml-1 text-[10px] text-slate-400 underline hover:text-slate-600 disabled:opacity-50"
        >
          all
        </button>
      )}
    </div>
  );
}
