'use client';

export interface UsageBucket {
  key: string;
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-3 py-1.5 font-medium">{t('admin.aiSettings.colName')}</th>
            <th className="px-3 py-1.5 text-right font-medium">{t('admin.aiSettings.colCost')}</th>
            <th className="px-3 py-1.5 text-right font-medium">{t('admin.aiSettings.colCalls')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="truncate px-3 py-1.5 text-foreground">{r.key}</td>
              <td className="px-3 py-1.5 text-right text-foreground-secondary">{eur(r.costEur)}</td>
              <td className="px-3 py-1.5 text-right text-foreground-secondary">{r.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <div className="grid grid-cols-3 gap-3">
        <Metric label={t('admin.aiSettings.totalCost')} value={eur(rollup.total.costEur)} />
        <Metric label={t('admin.aiSettings.totalCalls')} value={String(rollup.total.calls)} />
        <Metric label={t('admin.aiSettings.totalTokens')} value={tokens.toLocaleString()} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title={t('admin.aiSettings.byFeature')} rows={rollup.byFeature} t={t} />
        <Breakdown title={t('admin.aiSettings.byModel')} rows={rollup.byModel} t={t} />
        <Breakdown title={t('admin.aiSettings.byProvider')} rows={rollup.byProvider} t={t} />
        {rollup.byOrg && (
          <Breakdown title={t('admin.aiSettings.byOrg')} rows={rollup.byOrg} t={t} />
        )}
      </div>
    </div>
  );
}
