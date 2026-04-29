'use client';

import { useEffect, useState } from 'react';

interface Member {
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
}

interface AuditEntry {
  id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  owner_email: string | null;
  member_count: number;
  event_count: number;
  created_at: string;
  members: Member[];
  recent_audit_log: AuditEntry[];
}

interface Props {
  params: Promise<{ id: string }>;
}

export default function AdminOrgDetailPage({ params }: Props) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Resolve params
  useEffect(() => {
    void params.then(({ id }) => setOrgId(id));
  }, [params]);

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/organizations/${orgId}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to load organization');
        setOrg((await res.json()) as OrgDetail);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, apiUrl]);

  async function handleAction(action: 'suspend' | 'reactivate' | 'delete') {
    if (!orgId) return;
    const labels = { suspend: 'suspend', reactivate: 'reactivate', delete: 'permanently delete' };
    if (!confirm(`Are you sure you want to ${labels[action]} this organization?`)) return;

    const method = action === 'delete' ? 'DELETE' : 'PATCH';
    const url = `${apiUrl}/api/v1/admin/organizations/${orgId}${action !== 'delete' ? `/${action}` : ''}`;
    const res = await fetch(url, { method, credentials: 'include' });

    if (res.ok || res.status === 204) {
      if (action === 'delete') {
        window.location.href = '/admin/organizations';
      } else {
        window.location.reload();
      }
    } else {
      alert('Action failed. Please try again.');
    }
  }

  async function handleReassignOwner() {
    if (!orgId) return;
    const newOwnerUserId = prompt('Enter the user ID of the new owner:');
    if (!newOwnerUserId?.trim()) return;

    const res = await fetch(`${apiUrl}/api/v1/admin/organizations/${orgId}/reassign-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ newOwnerUserId: newOwnerUserId.trim() }),
    });

    if (res.ok || res.status === 204) {
      window.location.reload();
    } else {
      const data = (await res.json()) as { message?: string };
      alert(data.message ?? 'Failed to reassign owner');
    }
  }

  async function handlePromoteSuperAdmin() {
    const userId = prompt('Enter the user ID to promote to super admin:');
    if (!userId?.trim()) return;

    const res = await fetch(`${apiUrl}/api/v1/admin/users/promote-super-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: userId.trim() }),
    });

    if (res.ok || res.status === 204) {
      alert('User promoted to super admin.');
    } else {
      alert('Failed to promote user.');
    }
  }

  if (loading) return <main className="p-8"><p className="text-gray-400">Loading…</p></main>;
  if (error) return <main className="p-8"><p className="text-red-600">{error}</p></main>;
  if (!org) return null;

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-2">
        <a href="/admin/organizations" className="text-sm text-gray-500 hover:underline">
          ← All organizations
        </a>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="text-gray-500 text-sm font-mono mt-0.5">{org.slug}</p>
        </div>
        <span className={`mt-1 inline-block px-3 py-1 rounded-full text-sm font-medium ${
          org.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          {org.status}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Members', value: org.member_count },
          { label: 'Events', value: org.event_count },
          { label: 'Created', value: new Date(org.created_at).toLocaleDateString('fr-FR') },
        ].map(({ label, value }) => (
          <div key={label} className="border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-xl font-semibold mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Actions</h2>
        <div className="flex flex-wrap gap-2">
          {org.status === 'active' ? (
            <button
              onClick={() => { void handleAction('suspend'); }}
              className="px-4 py-2 rounded-md text-sm font-medium bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors"
            >
              Suspend organization
            </button>
          ) : (
            <button
              onClick={() => { void handleAction('reactivate'); }}
              className="px-4 py-2 rounded-md text-sm font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
            >
              Reactivate organization
            </button>
          )}
          <button
            onClick={() => { void handleReassignOwner(); }}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
          >
            Reassign ownership
          </button>
          <button
            onClick={() => { void handlePromoteSuperAdmin(); }}
            className="px-4 py-2 rounded-md text-sm font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
          >
            Promote member to super admin
          </button>
          <button
            onClick={() => { void handleAction('delete'); }}
            className="px-4 py-2 rounded-md text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
          >
            Delete (hard)
          </button>
        </div>
      </section>

      {/* Members */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Members ({org.members.length})</h2>
        {org.members.length === 0 ? (
          <p className="text-gray-400 text-sm">No members.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">User ID</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {org.members.map((m) => (
                <tr key={m.user_id} className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-mono text-xs text-gray-600">{m.user_id}</td>
                  <td className="py-2 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      m.role === 'owner' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="py-2 text-gray-500">
                    {new Date(m.joined_at).toLocaleDateString('fr-FR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Audit log */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Recent audit log</h2>
        {org.recent_audit_log.length === 0 ? (
          <p className="text-gray-400 text-sm">No audit log entries yet.</p>
        ) : (
          <div className="space-y-2">
            {org.recent_audit_log.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 text-sm border-b border-gray-100 pb-2">
                <span className="text-gray-400 text-xs whitespace-nowrap mt-0.5">
                  {new Date(entry.created_at).toLocaleString('fr-FR')}
                </span>
                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
                  {entry.action}
                </span>
                <span className="text-gray-500 text-xs font-mono">
                  by {entry.actor_user_id}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
