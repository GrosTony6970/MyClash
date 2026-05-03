'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface AdminUser {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  app_metadata?: Record<string, unknown>;
}

interface UserListResponse {
  users: AdminUser[];
}

function isDisabled(user: AdminUser): boolean {
  return Boolean(user.banned_until);
}

export default function AdminUsersPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/users?perPage=100`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setError('Access denied. Super admin required.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error('Failed to load users');
        const data = (await res.json()) as UserListResponse;
        if (!cancelled) {
          setUsers(data.users ?? []);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Something went wrong');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, refreshKey]);

  async function handleUserAction(user: AdminUser, action: 'disable' | 'enable') {
    const label = action === 'disable' ? 'disable' : 'enable';
    if (!confirm(`Are you sure you want to ${label} ${user.email ?? user.id}?`)) return;

    const res = await fetch(`${apiUrl}/api/v1/admin/users/${user.id}/${action}`, {
      method: 'PATCH',
      credentials: 'include',
    });

    if (res.ok || res.status === 204) {
      refresh();
      return;
    }

    alert('Action failed. Please try again.');
  }

  return (
    <main className="p-8">
      <div className="mb-2">
        <Link href="/admin" className="text-sm text-gray-500 hover:underline">
          Back to admin
        </Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-gray-500 text-sm mt-1">Disable or restore platform accounts.</p>
        </div>
        <button
          onClick={refresh}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : users.length === 0 ? (
        <p className="text-gray-400 text-sm">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">User ID</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Last sign-in</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const disabled = isDisabled(user);
                return (
                  <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-4 font-medium">{user.email ?? 'No email'}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{user.id}</td>
                    <td className="py-2 pr-4 text-gray-500">
                      {user.created_at
                        ? new Date(user.created_at).toLocaleDateString('fr-FR')
                        : '-'}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">
                      {user.last_sign_in_at
                        ? new Date(user.last_sign_in_at).toLocaleDateString('fr-FR')
                        : '-'}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          disabled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {disabled ? 'disabled' : 'active'}
                      </span>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => {
                          void handleUserAction(user, disabled ? 'enable' : 'disable');
                        }}
                        className={`text-xs hover:underline ${
                          disabled ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {disabled ? 'Enable' : 'Disable'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
