'use client';

import { useI18n } from '@myclash/next-i18n/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/** The settings tab a wizard step's rules live on. */
export type SettingsTab = 'basics' | 'match-format' | 'display' | 'advanced';

/**
 * A wizard step's change that needs the audit (`rules_change_needs_audit`; ruling 168): the wizard
 * has no dialog, so the step says so above its button and links to the matching tab of the
 * Tournament's settings, where the change is confirmed.
 */
export function RulesChangeElsewhere({
  tournamentId,
  tab,
}: {
  tournamentId: string;
  tab: SettingsTab;
}) {
  const { t } = useI18n();
  const params = useParams<{ slug: string; eventId: string }>();
  const href = `/org/${params.slug}/events/${params.eventId}/tournaments/${tournamentId}/settings#${tab}`;
  return (
    <p
      role="status"
      className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      {t('admin.rulesChange.elsewhere')}{' '}
      <Link href={href} className="font-semibold underline">
        {t('admin.rulesChange.openSettings')}
      </Link>
    </p>
  );
}
