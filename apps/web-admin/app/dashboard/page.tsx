'use client';

import { useEffect } from 'react';

/**
 * /dashboard — landing page after organizer login.
 * Fetches /api/v1/me to find the user's org slug, then redirects to /org/<slug>.
 * If no org found (shouldn't happen post-T-009b), shows a fallback.
 */
export default function DashboardPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  useEffect(() => {
    async function redirect() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
        if (!res.ok) {
          window.location.href = '/login';
          return;
        }
        // Org slug lookup will be wired in T-105 when organizations table exists.
        // For now, redirect to /login if not authenticated.
        const data = (await res.json()) as { type: string };
        if (data.type !== 'claimed') {
          window.location.href = '/login';
        }
        // TODO (T-105): fetch org slug from /api/v1/me or /api/v1/organizations/mine
        // and redirect to /org/<slug>
      } catch {
        window.location.href = '/login';
      }
    }
    void redirect();
  }, [apiUrl]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">Redirecting to your dashboard…</p>
    </main>
  );
}
