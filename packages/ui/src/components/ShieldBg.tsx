import * as React from 'react';

/**
 * ShieldBg — decorative HEMA shield SVG background element.
 * Used as a hero/section background motif.
 */
export interface ShieldBgProps {
  className?: string;
  /** Fill color (CSS color string). Default: currentColor. */
  color?: string;
  /** Opacity 0–1. Default: 0.05. */
  opacity?: number;
  size?: number;
}

export const ShieldBg = ({
  className = '',
  color = 'currentColor',
  opacity = 0.05,
  size = 400,
}: ShieldBgProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={['pointer-events-none select-none', className].join(' ')}
    aria-hidden="true"
  >
    {/* Classic heater shield shape */}
    <path d="M50 4 L96 20 L96 60 Q96 95 50 116 Q4 95 4 60 L4 20 Z" fill={color} opacity={opacity} />
    {/* Inner shield line */}
    <path
      d="M50 12 L88 26 L88 60 Q88 90 50 108 Q12 90 12 60 L12 26 Z"
      fill="none"
      stroke={color}
      strokeWidth="1"
      opacity={opacity * 2}
    />
    {/* Cross motif */}
    <line
      x1="50"
      y1="20"
      x2="50"
      y2="100"
      stroke={color}
      strokeWidth="1.5"
      opacity={opacity * 1.5}
    />
    <line
      x1="20"
      y1="50"
      x2="80"
      y2="50"
      stroke={color}
      strokeWidth="1.5"
      opacity={opacity * 1.5}
    />
  </svg>
);

/**
 * ShieldIcon — smaller inline shield icon for UI use.
 */
export const ShieldIcon = ({
  className = '',
  size = 24,
}: {
  className?: string;
  size?: number;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M12 1 L23 5 L23 14 Q23 22 12 27 Q1 22 1 14 L1 5 Z"
      fill="currentColor"
      fillOpacity="0.15"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);
