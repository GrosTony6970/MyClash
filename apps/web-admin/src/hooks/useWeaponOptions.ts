'use client';

import { useEffect, useState } from 'react';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface WeaponCatalogEntry {
  id: string;
  slug: string;
  name: string;
  active: boolean;
}

/**
 * Fetches the active shared weapon catalog once (GET /api/v1/weapons?active=true)
 * and returns the display names, sorted by the API (alphabetical). Powers the
 * strict weapon dropdowns on the tournament wizard/settings and the workshop
 * editor — the single source of truth curated at /admin/weapons.
 *
 * Best-effort: a failed/aborted fetch yields an empty list (the picker just
 * shows no presets) rather than throwing. Setting state happens inside the
 * async callback (not synchronously in the effect body) to satisfy the
 * `react-hooks/set-state-in-effect` lint.
 */
export function useWeaponOptions(): string[] {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/weapons?active=true`, {
          credentials: 'include',
        });
        if (!cancelled && res.ok) {
          const rows = (await res.json()) as WeaponCatalogEntry[];
          setOptions(rows.map((r) => r.name));
        }
      } catch {
        // Best-effort — a transient failure leaves the preset list empty.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return options;
}
