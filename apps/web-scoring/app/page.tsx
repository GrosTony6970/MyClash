'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Root page — checks auth and redirects:
 * - Authenticated → /lices
 * - Anonymous → /login
 */
export default function RootPage() {
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
        const me = (await res.json()) as { type: string };
        if (me.type === 'anonymous') {
          router.replace('/login');
        } else {
          router.replace('/lices');
        }
      } catch {
        // Offline or API unreachable — go to login
        router.replace('/login');
      }
    })();
  }, [apiUrl, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3">⚔️</div>
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    </main>
  );
}
