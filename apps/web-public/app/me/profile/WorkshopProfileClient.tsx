'use client';

import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Skeleton } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { weaponKey } from '@/lib/weapon-stats';
import { WorkshopCard, type WorkshopListItem } from '@/components/workshops/WorkshopCard';

interface WorkshopHistoryGroup {
  event: {
    id: string;
    slug: string;
    name: string;
    timezone: string | null;
    startDate: string | null;
  };
  workshops: WorkshopListItem[];
}

interface WorkshopHistoryResponse {
  events: WorkshopHistoryGroup[];
}

const UNSPECIFIED_WEAPON = '__unspecified__';

/** Count tile mirroring the fighter dashboard's DashboardStat (tokenized). */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/**
 * Personal "Workshop profile": every workshop the signed-in user has attended
 * (confirmed / intent), grouped by event, with three stat cards — events with
 * workshops, workshops attended, and a per-weapon breakdown. Reuses the shared
 * WorkshopCard for each row and weaponKey for weapon normalization.
 */
export function WorkshopProfileClient({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<WorkshopHistoryGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/workshop-history`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('workshop-history');
        const data = (await response.json()) as WorkshopHistoryResponse;
        setGroups(data.events ?? []);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError(t('publicApp.workshopProfile.loadError'));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, t]);

  const stats = useMemo(() => {
    const list = groups ?? [];
    const allWorkshops = list.flatMap((g) => g.workshops);
    // Group by normalized weapon key; keep the first raw label seen for display.
    const byWeapon = new Map<string, { label: string; count: number }>();
    for (const w of allWorkshops) {
      const raw = w.weapon?.trim();
      const key = raw ? weaponKey(raw) : UNSPECIFIED_WEAPON;
      const existing = byWeapon.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byWeapon.set(key, {
          label: raw || t('publicApp.workshopProfile.unspecifiedWeapon'),
          count: 1,
        });
      }
    }
    return {
      eventCount: list.length,
      workshopCount: allWorkshops.length,
      byWeapon: [...byWeapon.values()].sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label),
      ),
    };
  }, [groups, t]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
        {error}
      </div>
    );
  }

  const groupsList = groups ?? [];

  if (groupsList.length === 0) {
    return (
      <EmptyState
        icon="🎓"
        title={t('publicApp.workshopProfile.emptyTitle')}
        description={t('publicApp.workshopProfile.emptyDescription')}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t('publicApp.workshopProfile.statEvents')} value={stats.eventCount} />
          <Stat label={t('publicApp.workshopProfile.statWorkshops')} value={stats.workshopCount} />
          <Stat label={t('publicApp.workshopProfile.statWeapons')} value={stats.byWeapon.length} />
        </div>
        {stats.byWeapon.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-widest text-muted">
              {t('publicApp.workshopProfile.byWeaponTitle')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {stats.byWeapon.map((w) => (
                <span
                  key={w.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground"
                >
                  <span className="font-medium">{w.label}</span>
                  <span className="tabular-nums text-muted">{w.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Grouped by event */}
      {groupsList.map((group) => (
        <section
          key={group.event.id}
          className="rounded-lg border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {group.event.name}
            </h2>
            <span className="flex-shrink-0 text-xs text-muted">
              {group.workshops.length === 1
                ? t('publicApp.workshopProfile.workshopsSingular', {
                    count: group.workshops.length,
                  })
                : t('publicApp.workshopProfile.workshopsPlural', { count: group.workshops.length })}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {group.workshops.map((workshop) => (
              <WorkshopCard
                key={workshop.id}
                workshop={workshop}
                timezone={group.event.timezone ?? 'Europe/Paris'}
                showLocation
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
