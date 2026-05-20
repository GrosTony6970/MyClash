'use client';

import * as React from 'react';

/**
 * RowActionButton — the bordered-pill style used by every per-row action
 * inside admin list tables. Centralizes what used to be four different
 * styles (bordered pills on Leagues/Users, bare colored links on
 * Clubs/Rulesets/Organizations, oversized pills on Exchange-Edit-Requests).
 *
 * Use `<RowActionButton variant="...">` for button actions. For navigation
 * actions that need a `<Link>` (Next.js or a plain `<a>`), spread the
 * className from `rowActionClasses(variant)` onto the link element — this
 * avoids leaking a Next.js dependency into the shared UI package.
 */
export type RowActionVariant = 'edit' | 'success' | 'warning' | 'danger' | 'neutral';

const BASE_CLASS =
  'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50';

const VARIANT_CLASS: Record<RowActionVariant, string> = {
  edit: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
  success: 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  danger: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  neutral: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
};

export function rowActionClasses(variant: RowActionVariant = 'neutral'): string {
  return `${BASE_CLASS} ${VARIANT_CLASS[variant]}`;
}

export interface RowActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: RowActionVariant;
}

export const RowActionButton: React.FC<RowActionButtonProps> = ({
  variant = 'neutral',
  className = '',
  type = 'button',
  ...props
}) => (
  <button type={type} className={`${rowActionClasses(variant)} ${className}`.trim()} {...props} />
);
