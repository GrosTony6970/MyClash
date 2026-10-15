'use client';

import { CsvExportMenu, downloadServerCsv } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * The season report's CSV, asking which file (operator, 2026-10-15): Excel in French or the
 * others. The page is drawn on the server; this menu is the one part that answers a tap. `href`
 * is the public API address the page builds (`getPublicApiUrl`), never the server's own.
 */
export function LeagueReportCsv({ href }: { href: string }) {
  const { t, locale } = useI18n();
  return (
    <CsvExportMenu
      t={t}
      locale={locale}
      label={t('publicApp.leagues.downloadReport')}
      onExport={(format) => downloadServerCsv(href, format)}
      className="font-semibold text-accent hover:text-accent-hover"
    />
  );
}
