'use client';

import { useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import { Button, Card } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { claimTapRefusalKey, type ClaimPersonsResult } from '@/lib/claim-refusal';

type Claimable = { id: string; name: string; eventName: string };

/** One "this is me" tap: null when the row is hers now, else the key of what to say. */
async function claimRow(apiUrl: string, personId: string): Promise<string | null> {
  const result = await apiRequest<ClaimPersonsResult>(apiUrl, '/api/v1/me/claim-persons', {
    method: 'POST',
    body: { personIds: [personId] },
  });
  if (!result.ok) return 'publicApp.personalSpace.claimable.error';
  return claimTapRefusalKey(result.data);
}

/**
 * No Fighter profile linked yet. If the user has roster registrations on their email, offer to
 * claim one (which links the profile and unlocks the dashboard); otherwise point them to their
 * personal space.
 *
 * A claim the database refused says why (ruling 300): the account already holds a row at that
 * Event. The refused row leaves the suggestions at the reload that follows, so the sentence is
 * said in both states, with rows still offered and with none.
 */
export function NoLinkedProfile({
  apiUrl,
  claimable,
  error,
  onClaimed,
  onRefused,
}: {
  apiUrl: string;
  claimable: Claimable[];
  /** Why the dashboard did not load. */
  error: string;
  onClaimed: () => void;
  onRefused: () => void;
}) {
  const { t } = useI18n();
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function claim(personId: string): Promise<void> {
    setClaiming(true);
    const refusalKey = await claimRow(apiUrl, personId);
    setClaiming(false);
    setNotice(refusalKey && t(refusalKey));
    if (refusalKey) {
      onRefused();
    } else {
      onClaimed();
    }
  }

  if (claimable.length > 0) {
    return <ClaimRows claimable={claimable} busy={claiming} notice={notice} onClaim={claim} />;
  }
  return (
    <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
      <p className="text-sm text-danger" role="alert">
        {notice ?? error}
      </p>
      <p className="mt-2 text-xs text-muted">{t('publicApp.fighterProfile.accessRequired')}</p>
      <Button asChild variant="secondary" size="sm" className="mt-3">
        <a href="/me">{t('publicApp.fighterProfile.goToPersonalSpace')}</a>
      </Button>
    </div>
  );
}

function ClaimRows({
  claimable,
  busy,
  notice,
  onClaim,
}: {
  claimable: Claimable[];
  busy: boolean;
  notice: string | null;
  onClaim: (personId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('publicApp.personalSpace.claimable.title')}
      </h2>
      <p className="mt-1 text-xs text-muted">
        {t('publicApp.personalSpace.claimable.description')}
      </p>
      {notice && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {notice}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {claimable.map((person) => (
          <li
            key={person.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
          >
            <span className="min-w-0 text-sm text-foreground">
              <span className="font-semibold">{person.name}</span>
              {person.eventName && <span className="text-muted"> — {person.eventName}</span>}
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void onClaim(person.id)}
            >
              {t('publicApp.personalSpace.claimable.claim')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
