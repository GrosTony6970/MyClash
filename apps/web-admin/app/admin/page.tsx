import Link from 'next/link';
import { t } from '@myclash/i18n';

const sections = [
  {
    href: '/admin/organizations',
    title: 'Organizations',
    description: 'Approve, suspend, inspect, and recover organizer accounts.',
  },
  {
    href: '/admin/users',
    title: 'Users',
    description: 'Review platform accounts and disable abusive users.',
  },
  {
    href: '/admin/fighters',
    title: 'Fighters',
    description: 'Merge duplicate global fighter profiles with undo.',
  },
  {
    href: '/admin/rulesets',
    title: 'Rulesets',
    description: 'Moderate community-submitted ruleset metadata.',
  },
  {
    href: '/admin/feature-flags',
    title: 'Feature Flags',
    description: 'Control platform-wide feature switches.',
  },
  {
    href: '/admin/audit-log',
    title: 'Audit Log',
    description: 'Review moderation and organizer actions.',
  },
  {
    href: '/admin/exchange-edit-requests',
    title: 'Frozen Results',
    description: 'Approve or reject post-completion exchange corrections.',
  },
  {
    href: '/admin/system-versions',
    title: t('admin.dashboard.systemVersionsTitle'),
    description: t('admin.dashboard.systemVersionsDescription'),
  },
  {
    href: '/admin/backups',
    title: t('admin.dashboard.backupsTitle'),
    description: t('admin.dashboard.backupsDescription'),
  },
  {
    href: '/admin/leagues',
    title: t('admin.dashboard.leaguesTitle'),
    description: t('admin.dashboard.leaguesDescription'),
  },
];

export default function SuperAdminDashboardPage() {
  return (
    <main className="p-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold">{t('admin.dashboard.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('admin.dashboard.description')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="border border-gray-200 rounded-lg p-5 hover:border-red-300 hover:bg-red-50/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gray-950">{section.title}</h2>
                <p className="text-sm text-gray-500 mt-2 leading-6">{section.description}</p>
              </div>
              <span className="text-gray-300 text-lg" aria-hidden="true">
                -&gt;
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
