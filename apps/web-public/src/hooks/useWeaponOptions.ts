'use client';

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';

interface WeaponCatalogEntry {
  id: string;
  slug: string;
  name: string;
  active: boolean;
}

/**
 * Active shared weapon catalog names (GET /api/v1/weapons?active=true), the
 * single source of truth curated at /admin/weapons. Mirrors the web-admin hook,
 * but resolves the API URL via getApiUrl() — web-public forbids reading
 * NEXT_PUBLIC_API_URL directly. Best-effort: a failed/aborted fetch yields an
 * empty list (the picker just shows no presets). State is set inside the async
 * callback to satisfy the react-hooks/set-state-in-effect lint.
 */
export function useWeaponOptions(): string[] {
  const apiUrl = getApiUrl();
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
  }, [apiUrl]);

  return options;
}
