import * as React from 'react';
import { tintBgClassFor, tintTextClassFor, type ColorToken } from '../utils/color-token';

export interface SkillBadgeProps {
  color: ColorToken | string;
  label: string;
  size?: 'xs' | 'sm';
}

export function SkillBadge({ color, label, size = 'xs' }: SkillBadgeProps): React.ReactElement {
  return (
    <span
      className={[
        'inline-flex items-center rounded px-1.5 py-0.5 font-medium',
        size === 'xs' ? 'text-[10px]' : 'text-xs',
        tintBgClassFor(color),
        tintTextClassFor(color),
      ].join(' ')}
    >
      {label}
    </span>
  );
}
