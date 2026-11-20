'use client';

import { localeToBcp47 } from '@myclash/time';
import { DataTable, DataTableCell, DataTableHead, StatusBadge } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { PayloadCell } from '../../../src/components/PayloadCell';
import { type AuditLogEntry, OUTCOME_SEMANTIC } from './audit-entry';
import { EntryRow } from './EntryRow';

/**
 * The Audit tab's rows. A row opens the entry's side panel (ruling 911). The Result column marks
 * how a system action ended; a dash for a row that records no outcome (ruling 914).
 */
export function AuditLogTable({
  items,
  selectedId,
  onOpen,
}: {
  items: readonly AuditLogEntry[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <DataTable className="min-w-[1100px]">
      <DataTableHead>
        <DataTableCell as="th">{t('admin.auditLog.columns.created')}</DataTableCell>
        <DataTableCell as="th">{t('admin.auditLog.columns.result')}</DataTableCell>
        <DataTableCell as="th">{t('admin.auditLog.columns.actor')}</DataTableCell>
        <DataTableCell as="th">{t('admin.auditLog.columns.action')}</DataTableCell>
        <DataTableCell as="th">{t('admin.auditLog.columns.entity')}</DataTableCell>
        <DataTableCell as="th">{t('admin.auditLog.columns.payload')}</DataTableCell>
      </DataTableHead>
      <tbody>
        {items.map((entry) => (
          <EntryRow
            key={entry.id}
            id={entry.id}
            time={new Date(entry.created_at).toLocaleString(localeToBcp47(locale))}
            selected={entry.id === selectedId}
            onOpen={onOpen}
          >
            <AuditCells entry={entry} />
          </EntryRow>
        ))}
      </tbody>
    </DataTable>
  );
}

function AuditCells({ entry }: { entry: AuditLogEntry }) {
  const { t } = useI18n();
  return (
    <>
      <DataTableCell>
        <ResultMark outcome={entry.outcome} />
      </DataTableCell>
      <DataTableCell className="text-xs text-foreground-secondary">
        {entry.actor_user_id ? (
          <p className="font-medium">
            {entry.actorName ?? entry.actorEmail ?? t('admin.common.unknownUser')}
          </p>
        ) : (
          <span className="text-muted">—</span>
        )}
        {entry.actorName && entry.actorEmail && (
          <p className="font-mono text-muted">{entry.actorEmail}</p>
        )}
      </DataTableCell>
      <DataTableCell>
        <span className="rounded bg-background px-2 py-1 font-mono text-xs">{entry.action}</span>
      </DataTableCell>
      <DataTableCell>
        <p className="font-medium">{entry.entity_type}</p>
        {entry.entityLabel && (
          <p className="text-sm text-foreground-secondary">{entry.entityLabel}</p>
        )}
        <p
          className="font-mono text-xs text-muted max-w-[220px] truncate"
          title={entry.entity_id ?? ''}
        >
          {entry.entity_id}
        </p>
      </DataTableCell>
      <DataTableCell>
        <PayloadCell payload={entry.payload_json} labels={entry.payloadLabels ?? {}} />
      </DataTableCell>
    </>
  );
}

/** The Result chip, or a dash with a spoken name; the list and the panel share it. */
export function ResultMark({ outcome }: { outcome: AuditLogEntry['outcome'] }) {
  const { t } = useI18n();
  if (!outcome) {
    return (
      <span className="text-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('admin.auditLog.result.none')}</span>
      </span>
    );
  }
  return (
    <StatusBadge semantic={OUTCOME_SEMANTIC[outcome]} size="sm">
      {t(`admin.auditLog.result.${outcome}`)}
    </StatusBadge>
  );
}
