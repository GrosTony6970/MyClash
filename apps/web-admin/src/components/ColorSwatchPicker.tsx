'use client';

export const SWATCH_PALETTE: readonly string[] = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#64748b',
];

export function ColorSwatchPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (hex: string) => void;
  ariaLabel?: string;
}) {
  const normalized = value.toLowerCase();
  return (
    <div role="radiogroup" aria-label={ariaLabel ?? 'Color'} className="grid grid-cols-4 gap-1.5">
      {SWATCH_PALETTE.map((hex) => {
        const selected = hex.toLowerCase() === normalized;
        return (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={hex}
            title={hex}
            onClick={() => onChange(hex)}
            style={{ backgroundColor: hex }}
            className={[
              'h-7 w-7 rounded border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-accent',
              selected ? 'border-strong ring-2 ring-strong ring-offset-1' : 'border-border',
            ].join(' ')}
          />
        );
      })}
    </div>
  );
}
