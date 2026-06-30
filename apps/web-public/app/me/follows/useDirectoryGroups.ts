'use client';

import { useEffect, useState } from 'react';

export interface MemberCard {
  globalPersonId: string;
  slug: string;
  displayName: string;
  photoUrl: string | null;
  countryCode: string | null;
  clubName: string | null;
  favoriteWeapon: string | null;
  matches: number;
  wins: number;
  losses: number;
  winRate: number | null;
  eventsAttended: number;
  upcomingEventCount: number;
  followingEventCount: number;
}

export interface DirectoryGroup {
  id: string;
  name: string;
  members: MemberCard[];
}

/** Minimal person shape the Search tab / group picker passes to addMember. */
export interface SearchPerson {
  id: string;
  slug: string;
  displayName: string;
  clubName: string | null;
  photoUrl: string | null;
  countryCode: string | null;
}

export interface FollowAllSummary {
  globalPersonId: string;
  upcomingEventCount: number;
  followedCount: number;
  alreadyFollowingCount: number;
  skippedPrivacyCount: number;
}

type Status = 'loading' | 'ready' | 'error' | 'unauthorized';

const BASE = '/api/v1/me/groups';

function placeholderMember(person: SearchPerson): MemberCard {
  return {
    globalPersonId: person.id,
    slug: person.slug,
    displayName: person.displayName,
    photoUrl: person.photoUrl,
    countryCode: person.countryCode,
    clubName: person.clubName,
    favoriteWeapon: null,
    matches: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    eventsAttended: 0,
    upcomingEventCount: 0,
    followingEventCount: 0,
  };
}

/**
 * Owns the user's directory groups (the "People" hub state) and the hub-level
 * follow actions. Mirrors FollowsClient's optimistic idiom: mutate state first,
 * roll back on failure, surface errors inline.
 */
export function useDirectoryGroups(apiUrl: string) {
  const [groups, setGroups] = useState<DirectoryGroup[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}${BASE}`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) {
          setStatus('unauthorized');
          return;
        }
        if (!res.ok) throw new Error('load');
        const data = (await res.json()) as DirectoryGroup[];
        setGroups(data.map((g) => ({ id: g.id, name: g.name, members: g.members ?? [] })));
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [apiUrl]);

  async function createGroup(name: string): Promise<DirectoryGroup | null> {
    setActionError(null);
    const tmpId = `tmp-${name}-${groups.length}`;
    const optimistic: DirectoryGroup = { id: tmpId, name, members: [] };
    const previous = groups;
    setGroups((prev) => [optimistic, ...prev]);
    try {
      const res = await fetch(`${apiUrl}${BASE}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(res.status === 409 ? 'nameInUse' : 'create');
      const created = (await res.json()) as { id: string; name: string };
      const real: DirectoryGroup = { id: created.id, name: created.name, members: [] };
      setGroups((prev) => prev.map((g) => (g.id === tmpId ? real : g)));
      return real;
    } catch (err) {
      setGroups(previous);
      setActionError(err instanceof Error && err.message === 'nameInUse' ? 'nameInUse' : 'create');
      return null;
    }
  }

  async function renameGroup(groupId: string, name: string): Promise<void> {
    setActionError(null);
    const previous = groups;
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
    try {
      const res = await fetch(`${apiUrl}${BASE}/${groupId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(res.status === 409 ? 'nameInUse' : 'update');
    } catch (err) {
      setGroups(previous);
      setActionError(err instanceof Error && err.message === 'nameInUse' ? 'nameInUse' : 'update');
    }
  }

  async function deleteGroup(groupId: string): Promise<void> {
    setActionError(null);
    const previous = groups;
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    try {
      const res = await fetch(`${apiUrl}${BASE}/${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('update');
    } catch {
      setGroups(previous);
      setActionError('update');
    }
  }

  async function addMember(groupId: string, person: SearchPerson): Promise<void> {
    setActionError(null);
    const previous = groups;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && !g.members.some((m) => m.globalPersonId === person.id)
          ? { ...g, members: [...g.members, placeholderMember(person)] }
          : g,
      ),
    );
    try {
      const res = await fetch(`${apiUrl}${BASE}/${groupId}/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalPersonId: person.id }),
      });
      if (!res.ok) throw new Error('update');
      const card = (await res.json()) as MemberCard;
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, members: g.members.map((m) => (m.globalPersonId === person.id ? card : m)) }
            : g,
        ),
      );
    } catch {
      setGroups(previous);
      setActionError('update');
    }
  }

  async function removeMember(groupId: string, globalPersonId: string): Promise<void> {
    setActionError(null);
    const previous = groups;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, members: g.members.filter((m) => m.globalPersonId !== globalPersonId) }
          : g,
      ),
    );
    try {
      const res = await fetch(`${apiUrl}${BASE}/${groupId}/members/${globalPersonId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('update');
    } catch {
      setGroups(previous);
      setActionError('update');
    }
  }

  async function createGroupWithMember(name: string, person: SearchPerson): Promise<void> {
    const group = await createGroup(name);
    if (group) await addMember(group.id, person);
  }

  /** Follow a person across all their current/upcoming events (hub shortcut). */
  async function followPerson(globalPersonId: string): Promise<FollowAllSummary | null> {
    setActionError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/follows/by-global-person`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalPersonId }),
      });
      if (!res.ok) throw new Error('follow');
      const summary = (await res.json()) as FollowAllSummary;
      const followingEventCount = summary.followedCount + summary.alreadyFollowingCount;
      patchMemberFollowState(globalPersonId, summary.upcomingEventCount, followingEventCount);
      return summary;
    } catch {
      setActionError('follow');
      return null;
    }
  }

  async function unfollowPerson(globalPersonId: string): Promise<boolean> {
    setActionError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/follows/by-global-person/${globalPersonId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('follow');
      patchMemberFollowState(globalPersonId, undefined, 0);
      return true;
    } catch {
      setActionError('follow');
      return false;
    }
  }

  function patchMemberFollowState(
    globalPersonId: string,
    upcomingEventCount: number | undefined,
    followingEventCount: number,
  ): void {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        members: g.members.map((m) =>
          m.globalPersonId === globalPersonId
            ? {
                ...m,
                followingEventCount,
                upcomingEventCount: upcomingEventCount ?? m.upcomingEventCount,
              }
            : m,
        ),
      })),
    );
  }

  return {
    groups,
    status,
    actionError,
    createGroup,
    renameGroup,
    deleteGroup,
    addMember,
    removeMember,
    createGroupWithMember,
    followPerson,
    unfollowPerson,
  };
}
