'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  owner_email: string | null;
  member_count: number;
  event_count: number;
  created_at: string;
  last_activity: string | null;
}

type SortField = 'name' | 'created_at' | 'member_count' | 'event_count';

export default function AdminOrganizationsPage() {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    params.set(
      'sortBy',
      sortField === 'member_count' || sortField === 'event_count' ? 'created_at' : sortField,
    );
    params.set('order', sortOrder);

    const controller = new AbortController();

    fetch(`${apiUrl}/api/v1/admin/organizations?${params}`, {
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
        if (!res.ok) throw new Error('Failed to load organizations');
        const data = (await res.json()) as OrgListItem[];
        if (!cancelled) {
          setOrgs(data);
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
  }, [apiUrl, search, statusFilter, sortField, sortOrder, refreshKey]);

  async function handleAction(orgId: string, action: 'suspend' | 'approve' | 'delete') {
    const labels = {
      suspend: 'suspend',
      approve: 'approve/reactivate',
      delete: 'permanently delete',
    };
    if (!confirm(`Are you sure you want to ${labels[action]} this organization?`)) return;

    const method = action === 'delete' ? 'DELETE' : 'PATCH';
    const url = `${apiUrl}/api/v1/admin/organizations/${orgId}${action !== 'delete' ? `/${action}` : ''}`;

    const res = await fetch(url, { method, credentials: 'include' });
    if (res.ok || res.status === 204) {
      refresh();
    } else {
      alert('Action failed. Please try again.');
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }

  const sortIcon = (field: SortField) =>
    sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Organizations</h1>
          <p className="text-gray-500 text-sm mt-1">Super admin — manage all organizer accounts</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="search"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600 w-56"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : orgs.length === 0 ? (
        <p className="text-gray-400 text-sm">No organizations found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th
                  className="py-2 pr-4 cursor-pointer hover:text-gray-800"
                  onClick={() => toggleSort('name')}
                >
                  Name{sortIcon('name')}
                </th>
                <th className="py-2 pr-4">Owner</th>
                <th
                  className="py-2 pr-4 cursor-pointer hover:text-gray-800"
                  onClick={() => toggleSort('member_count')}
                >
                  Members{sortIcon('member_count')}
                </th>
                <th
                  className="py-2 pr-4 cursor-pointer hover:text-gray-800"
                  onClick={() => toggleSort('event_count')}
                >
                  Events{sortIcon('event_count')}
                </th>
                <th className="py-2 pr-4">Status</th>
                <th
                  className="py-2 pr-4 cursor-pointer hover:text-gray-800"
                  onClick={() => toggleSort('created_at')}
                >
                  Created{sortIcon('created_at')}
                </th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/organizations/${org.id}`}
                      className="font-medium text-red-700 hover:underline"
                    >
                      {org.name}
                    </Link>
                    <span className="ml-2 text-gray-400 text-xs font-mono">{org.slug}</span>
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{org.owner_email ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-600">{org.member_count}</td>
                  <td className="py-2 pr-4 text-gray-600">{org.event_count}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        org.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {org.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-500">
                    {new Date(org.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      {org.status === 'active' ? (
                        <button
                          onClick={() => {
                            void handleAction(org.id, 'suspend');
                          }}
                          className="text-xs text-orange-600 hover:underline"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            void handleAction(org.id, 'approve');
                          }}
                          className="text-xs text-green-600 hover:underline"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => {
                          void handleAction(org.id, 'delete');
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
