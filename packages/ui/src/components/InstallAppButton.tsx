'use client';

import { useSyncExternalStore } from 'react';
import { Button } from './Button';
import {
  askToInstall,
  noInstallOffer,
  readInstallOffer,
  subscribeInstallOffer,
} from '../hooks/install-offer';

export interface InstallAppButtonProps {
  /** Translated by the app: `@myclash/ui` has no i18n. */
  label: string;
  className?: string;
}

/**
 * "Install the app": shown only while the browser offers to install it
 * (`install-offer.ts`), and gone once it is installed. Needs
 * `InstallOfferCapture` in the root layout, or no offer is ever kept.
 */
export function InstallAppButton({ label, className }: InstallAppButtonProps) {
  const offer = useSyncExternalStore(
    (listener) => subscribeInstallOffer(listener),
    () => readInstallOffer(),
    noInstallOffer,
  );
  if (!offer) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void askToInstall()}
    >
      {label}
    </Button>
  );
}
