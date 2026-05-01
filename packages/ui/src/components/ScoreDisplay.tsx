import * as React from 'react';

/**
 * ScoreDisplay — red vs blue fighter score panel.
 * Used in scoring app and public live view.
 */
export interface ScoreDisplayProps {
  redName?: string;
  blueName?: string;
  redScore: number;
  blueScore: number;
  /** Highlight the leading side. */
  showLeader?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: { score: 'text-4xl', name: 'text-sm', label: 'text-xs' },
  md: { score: 'text-6xl', name: 'text-base', label: 'text-xs' },
  lg: { score: 'text-8xl', name: 'text-lg', label: 'text-sm' },
};

export const ScoreDisplay = ({
  redName = 'Rouge',
  blueName = 'Bleu',
  redScore,
  blueScore,
  showLeader = true,
  size = 'md',
}: ScoreDisplayProps) => {
  const sz = sizeMap[size];
  const redLeading = showLeader && redScore > blueScore;
  const blueLeading = showLeader && blueScore > redScore;

  return (
    <div className="grid grid-cols-3 items-center gap-4">
      {/* Red */}
      <div className="text-center">
        <div
          className={[
            'rounded-xl border-2 p-3',
            redLeading
              ? 'bg-red-900 border-red-500 shadow-[0_0_16px_rgb(220_38_38_/_0.5)]'
              : 'bg-red-950 border-red-800',
          ].join(' ')}
        >
          <p className={['font-bold uppercase tracking-wide text-red-300', sz.label].join(' ')}>
            Rouge
          </p>
          <p className={['font-bold text-white leading-tight mt-0.5', sz.name].join(' ')}>
            {redName}
          </p>
        </div>
        <p className={['font-black text-red-400 mt-2 tabular-nums', sz.score].join(' ')}>
          {redScore}
        </p>
      </div>

      {/* VS */}
      <div className="text-center">
        <p className="text-gray-500 text-2xl font-bold">VS</p>
      </div>

      {/* Blue */}
      <div className="text-center">
        <div
          className={[
            'rounded-xl border-2 p-3',
            blueLeading
              ? 'bg-blue-900 border-blue-500 shadow-[0_0_16px_rgb(37_99_235_/_0.5)]'
              : 'bg-blue-950 border-blue-800',
          ].join(' ')}
        >
          <p className={['font-bold uppercase tracking-wide text-blue-300', sz.label].join(' ')}>
            Bleu
          </p>
          <p className={['font-bold text-white leading-tight mt-0.5', sz.name].join(' ')}>
            {blueName}
          </p>
        </div>
        <p className={['font-black text-blue-400 mt-2 tabular-nums', sz.score].join(' ')}>
          {blueScore}
        </p>
      </div>
    </div>
  );
};
