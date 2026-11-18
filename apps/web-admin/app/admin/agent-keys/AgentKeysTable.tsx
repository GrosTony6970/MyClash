'use client';

import {
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  RowActionButton,
  StatusBadge,
} from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { localeToBcp47 } from '@myclash/time';
import type { AgentKeyRow } from './useAgentKeys';

/** One key: label, dates, status, and Revoke when it is live. Never the id. */
function AgentKeyTableRow({
  agentKey,
  onRevoke,
}: {
  agentKey: AgentKeyRow;
  onRevoke: (key: AgentKeyRow) => void;
}) {
  const { t, locale } = useI18n();
  const when = (value: string | null) =>
    value ? new Date(value).toLocaleString(localeToBcp47(locale)) : t('admin.agentKeys.never');
  const revoked = agentKey.revokedAt !== null;

  return (
    <DataTableRow>
      <DataTableCell className="font-medium text-foreground">{agentKey.label}</DataTableCell>
      <DataTableCell className="text-foreground-secondary">
        {when(agentKey.createdAt)}
      </DataTableCell>
      <DataTableCell className="text-foreground-secondary">
        {when(agentKey.lastUsedAt)}
      </DataTableCell>
      <DataTableCell>
        <StatusBadge semantic={revoked ? 'danger' : 'ready'} size="sm">
          {revoked ? t('admin.agentKeys.status.revoked') : t('admin.agentKeys.status.live')}
        </StatusBadge>
      </DataTableCell>
      <DataTableCell>
        {!revoked && (
          <RowActionButton variant="danger" onClick={() => onRevoke(agentKey)}>
            {t('admin.agentKeys.revoke')}
          </RowActionButton>
        )}
      </DataTableCell>
    </DataTableRow>
  );
}

export function AgentKeysTable({
  keys,
  onRevoke,
}: {
  keys: AgentKeyRow[];
  onRevoke: (key: AgentKeyRow) => void;
}) {
  const { t } = useI18n();
  return (
    <DataTable>
      <DataTableHead>
        <DataTableCell as="th">{t('admin.agentKeys.table.label')}</DataTableCell>
        <DataTableCell as="th">{t('admin.agentKeys.table.created')}</DataTableCell>
        <DataTableCell as="th">{t('admin.agentKeys.table.lastUsed')}</DataTableCell>
        <DataTableCell as="th">{t('admin.agentKeys.table.status')}</DataTableCell>
        <DataTableCell as="th">{t('admin.agentKeys.table.actions')}</DataTableCell>
      </DataTableHead>
      <tbody>
        {keys.map((key) => (
          <AgentKeyTableRow key={key.id} agentKey={key} onRevoke={onRevoke} />
        ))}
      </tbody>
    </DataTable>
  );
}
