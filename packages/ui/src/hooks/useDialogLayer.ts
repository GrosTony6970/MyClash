'use client';

import { useEffect, useRef } from 'react';
import { dialogLayers } from '../utils/dialog-layers';

/**
 * Make an open dialog (or drawer) a layer of the page: Escape reaches it only while it is the top
 * one (see `dialog-layers.ts`). The layer is pushed once per opening, so a re-render with a new
 * `onEscape` keeps its place; the latest `onEscape` is the one called.
 */
export function useDialogLayer(open: boolean, onEscape: () => void): void {
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });
  useEffect(() => {
    if (!open) return undefined;
    return dialogLayers().open(() => latest.current());
  }, [open]);
}
