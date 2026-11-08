'use client';

import { useState } from 'react';
import { ORG_MENU_PROFILES, type OrgMenuProfile } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { useOrganizerSelectedEvent } from '@/components/organizer-event-context';
import { getPublicApiUrl } from '@/lib/api-url';

const LABEL_KEYS = {
  everything: 'organizer.dashboard.menuProfile.everything',
  workshops: 'organizer.dashboard.menuProfile.workshops',
} as const satisfies Record<OrgMenuProfile, string>;

const HINT_KEYS = {
  everything: 'organizer.dashboard.menuProfile.everythingHint',
  workshops: 'organizer.dashboard.menuProfile.workshopsHint',
} as const satisfies Record<OrgMenuProfile, string>;

/** The stored profile, the last refusal, and a pick that saves then re-reads the organisation. */
function useMenuProfileSave(orgId: string | null) {
  const { t } = useI18n();
  const apiUrl = getPublicApiUrl();
  const { menuProfile, refetchOrg } = useOrganizerSelectedEvent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(next: OrgMenuProfile) {
    if (busy || !orgId || next === menuProfile) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiRequest(apiUrl, `/api/v1/organizations/${orgId}`, {
        method: 'PATCH',
        body: { menuProfile: next },
      });
      if (!r.ok) {
        const message = failureMessage(r, t, t('organizer.dashboard.menuProfile.saveError'));
        if (message) setError(message);
        return;
      }
      await refetchOrg();
    } finally {
      setBusy(false);
    }
  }

  return { menuProfile, error, pick };
}

/**
 * Everything / Workshops only: what the club's sidebar shows for every Event. Each pick saves at
 * once, as the photo mode does. It shows the stored profile (the shell's organisation read), so a
 * refused save leaves the old choice checked and says why. Every member sees it, as Branding; the
 * server refuses anyone but the owner. While a save runs a pick is ignored, not the inputs closed,
 * so the keyboard focus stays put.
 */
export function MenuProfileCard({ orgId }: { orgId: string | null }) {
  const { t } = useI18n();
  const { menuProfile, error, pick } = useMenuProfileSave(orgId);

  return (
    <fieldset className="mt-8 rounded-md border border-border bg-surface p-5">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {t('organizer.dashboard.menuProfile.legend')}
      </legend>
      <p className="text-sm text-muted">{t('organizer.dashboard.menuProfile.help')}</p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ORG_MENU_PROFILES.map((value) => (
          <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="menu-profile"
              value={value}
              checked={menuProfile === value}
              onChange={() => void pick(value)}
              className="mt-1"
            />
            <span>
              <span className="font-semibold text-foreground">{t(LABEL_KEYS[value])}</span>
              <span className="block text-xs text-muted">{t(HINT_KEYS[value])}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
