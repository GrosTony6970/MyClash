'use client';

import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';

export interface UsageBucket {
  key: string;
  /** Human-readable name for id-keyed buckets (event/org); rendered as label ?? key. */
  label?: string;
  costEur: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface UsageRollup {
  total: { costEur: number; inputTokens: number; outputTokens: number; calls: number };
  byFeature: UsageBucket[];
  byModel: UsageBucket[];
  byProvider: UsageBucket[];
  byDay: UsageBucket[];
  byEvent?: UsageBucket[];
  byOrg?: UsageBucket[];
  truncated?: boolean;
}

function eur(n: number): string {
  return `€${n.toFixed(4)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  t,
}: {
  title: string;
  rows: UsageBucket[];
  t: (key: string) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </p>
      <DataTable>
        <DataTableHead>
          <DataTableCell as="th">{t('admin.aiSettings.colName')}</DataTableCell>
          <DataTableCell as="th" className="text-right">
            {t('admin.aiSettings.colCost')}
          </DataTableCell>
          <DataTableCell as="th" className="text-right">
            {t('admin.aiSettings.colCalls')}
          </DataTableCell>
        </DataTableHead>
        <tbody>
          {rows.map((r) => (
            <DataTableRow key={r.key}>
              <DataTableCell className="max-w-0 truncate text-foreground" title={r.label ?? r.key}>
                {r.label ?? r.key}
              </DataTableCell>
              <DataTableCell className="text-right">{eur(r.costEur)}</DataTableCell>
              <DataTableCell className="text-right">{r.calls}</DataTableCell>
            </DataTableRow>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

/** Daily cost trend — CSS bars, no chart dependency. */
function TrendChart({ title, rows }: { title: string; rows: UsageBucket[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.costEur), Number.EPSILON);
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-3 text-sm font-semibold text-foreground">{title}</p>
      <div className="flex h-32 items-end gap-1">
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={`${r.key} · ${eur(r.costEur)} · ${r.calls}`}
          >
            <div
              className="w-full rounded-t bg-accent/70"
              style={{ height: `${Math.max(2, (r.costEur / max) * 100)}%` }}
            />
            <span className="w-full truncate text-center text-[10px] text-muted">
              {r.key.length >= 10 ? r.key.slice(5) : r.key}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiUsageView({
  rollup,
  t,
}: {
  rollup: UsageRollup | null;
  t: (key: string) => string;
}) {
  if (!rollup || rollup.total.calls === 0) {
    return <p className="text-sm text-muted">{t('admin.aiSettings.noUsage')}</p>;
  }
  const tokens = rollup.total.inputTokens + rollup.total.outputTokens;
  return (
    <div className="space-y-5">
      {rollup.truncated && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
          {t('admin.aiSettings.usageTruncated')}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Metric label={t('admin.aiSettings.totalCost')} value={eur(rollup.total.costEur)} />
        <Metric label={t('admin.aiSettings.totalCalls')} value={String(rollup.total.calls)} />
        <Metric label={t('admin.aiSettings.totalTokens')} value={tokens.toLocaleString()} />
      </div>
      {rollup.byDay.length > 0 && (
        <TrendChart title={t('admin.aiSettings.byDay')} rows={rollup.byDay} />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title={t('admin.aiSettings.byFeature')} rows={rollup.byFeature} t={t} />
        <Breakdown title={t('admin.aiSettings.byModel')} rows={rollup.byModel} t={t} />
        <Breakdown title={t('admin.aiSettings.byProvider')} rows={rollup.byProvider} t={t} />
        {rollup.byEvent && (
          <Breakdown title={t('admin.aiSettings.byEvent')} rows={rollup.byEvent} t={t} />
        )}
        {rollup.byOrg && (
          <Breakdown title={t('admin.aiSettings.byOrg')} rows={rollup.byOrg} t={t} />
        )}
      </div>
    </div>
  );
}
