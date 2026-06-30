/**
 * directory-groups.service.ts
 *
 * Personal collections of global persons (fighters) for the "People" hub.
 * Owner = claimed user. Organizer/bookmark only — no notifications.
 * Member cards reuse compact career stats (MemberStatsService) and the hub
 * follow-state (FollowsService) so the page renders in a couple of round-trips.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FollowsService } from '../follows/follows.service';
import { SupabaseService } from '../supabase/supabase.service';
import { MemberStatsService } from './member-stats.service';

export interface DirectoryGroup {
  id: string;
  name: string;
  sortOrder: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DirectoryGroupMemberCard {
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

export interface DirectoryGroupWithMembers extends DirectoryGroup {
  members: DirectoryGroupMemberCard[];
}

const MEMBER_SELECT = `
  group_id, global_person_id, sort_order, created_at,
  global_persons (
    id, slug, display_name, photo_url, country_code, deleted_at, merged_into_id,
    clubs ( name )
  )
`;

@Injectable()
export class DirectoryGroupsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly memberStats: MemberStatsService,
    private readonly follows: FollowsService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listGroups(userId: string): Promise<DirectoryGroupWithMembers[]> {
    const { data: groups } = await this.supabase.service
      .from('directory_groups')
      .select('id, name, sort_order, created_at, updated_at')
      .eq('owner_user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    const groupRows = (groups ?? []) as Array<Record<string, unknown>>;
    if (groupRows.length === 0) return [];

    const groupIds = groupRows.map((g) => g['id'] as string);
    const { data: members } = await this.supabase.service
      .from('directory_group_members')
      .select(MEMBER_SELECT)
      .in('group_id', groupIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    const memberRows = ((members ?? []) as Array<Record<string, unknown>>).filter((m) =>
      this.isVisible(m['global_persons']),
    );

    const personIds = [...new Set(memberRows.map((m) => m['global_person_id'] as string))];
    const ctx = await this.loadCardContext(personIds, userId);

    const byGroup = new Map<string, DirectoryGroupMemberCard[]>();
    for (const m of memberRows) {
      const card = this.toCard(m['global_persons'] as Record<string, unknown>, ctx);
      const list = byGroup.get(m['group_id'] as string) ?? [];
      list.push(card);
      byGroup.set(m['group_id'] as string, list);
    }

    return groupRows.map((g) => {
      const groupMembers = byGroup.get(g['id'] as string) ?? [];
      return { ...this.mapGroup(g, groupMembers.length), members: groupMembers };
    });
  }

  // ── Group mutations ──────────────────────────────────────────────────────

  async createGroup(userId: string, name: string): Promise<DirectoryGroup> {
    const { data, error } = await this.supabase.service
      .from('directory_groups')
      .insert({ owner_user_id: userId, name })
      .select('id, name, sort_order, created_at, updated_at')
      .single();
    if (error) throw this.translateWriteError(error);
    return this.mapGroup(data as Record<string, unknown>, 0);
  }

  async renameGroup(
    userId: string,
    groupId: string,
    patch: { name?: string; sortOrder?: number },
  ): Promise<DirectoryGroup> {
    await this.assertOwner(userId, groupId);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) updates['name'] = patch.name;
    if (patch.sortOrder !== undefined) updates['sort_order'] = patch.sortOrder;

    const { data, error } = await this.supabase.service
      .from('directory_groups')
      .update(updates)
      .eq('id', groupId)
      .eq('owner_user_id', userId)
      .select('id, name, sort_order, created_at, updated_at')
      .single();
    if (error) throw this.translateWriteError(error);

    const memberCount = await this.countMembers(groupId);
    return this.mapGroup(data as Record<string, unknown>, memberCount);
  }

  async deleteGroup(userId: string, groupId: string): Promise<void> {
    await this.assertOwner(userId, groupId);
    await this.supabase.service
      .from('directory_groups')
      .delete()
      .eq('id', groupId)
      .eq('owner_user_id', userId);
  }

  // ── Member mutations ─────────────────────────────────────────────────────

  async addMember(
    userId: string,
    groupId: string,
    input: { globalPersonId?: string; slug?: string },
  ): Promise<DirectoryGroupMemberCard> {
    await this.assertOwner(userId, groupId);
    const globalPersonId = await this.resolveGlobalPersonId(input);

    // Idempotent insert: ignore a duplicate (already in this group).
    const { error } = await this.supabase.service
      .from('directory_group_members')
      .upsert(
        { group_id: groupId, global_person_id: globalPersonId },
        { onConflict: 'group_id,global_person_id', ignoreDuplicates: true },
      );
    if (error) throw this.translateWriteError(error);

    const card = await this.fetchMemberCard(globalPersonId, userId);
    if (!card) throw new NotFoundException('Fighter not found');
    return card;
  }

  async removeMember(userId: string, groupId: string, globalPersonId: string): Promise<void> {
    await this.assertOwner(userId, groupId);
    await this.supabase.service
      .from('directory_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('global_person_id', globalPersonId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async resolveGlobalPersonId(input: {
    globalPersonId?: string;
    slug?: string;
  }): Promise<string> {
    if (input.globalPersonId) {
      const { data } = await this.supabase.service
        .from('global_persons')
        .select('id, deleted_at, merged_into_id')
        .eq('id', input.globalPersonId)
        .maybeSingle();
      const row = data as Record<string, unknown> | null;
      if (!row || row['deleted_at'] || row['merged_into_id']) {
        throw new NotFoundException('Fighter not found');
      }
      return row['id'] as string;
    }

    const { data } = await this.supabase.service
      .from('global_persons')
      .select('id, deleted_at, merged_into_id')
      .eq('slug', input.slug as string)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (!row || row['deleted_at'] || row['merged_into_id']) {
      throw new NotFoundException('Fighter not found');
    }
    return row['id'] as string;
  }

  private async fetchMemberCard(
    globalPersonId: string,
    userId: string,
  ): Promise<DirectoryGroupMemberCard | null> {
    const { data } = await this.supabase.service
      .from('global_persons')
      .select(
        'id, slug, display_name, photo_url, country_code, deleted_at, merged_into_id, clubs ( name )',
      )
      .eq('id', globalPersonId)
      .maybeSingle();
    if (!data || !this.isVisible(data)) return null;

    const ctx = await this.loadCardContext([globalPersonId], userId);
    return this.toCard(data as Record<string, unknown>, ctx);
  }

  private async loadCardContext(personIds: string[], userId: string) {
    const [stats, weapons, followState] = await Promise.all([
      this.memberStats.getCompactStats(personIds),
      this.memberStats.getFavoriteWeapons(personIds),
      this.follows.countFollowStateForGlobalPersons(personIds, { userId }),
    ]);
    return { stats, weapons, followState };
  }

  private toCard(
    gp: Record<string, unknown>,
    ctx: Awaited<ReturnType<DirectoryGroupsService['loadCardContext']>>,
  ): DirectoryGroupMemberCard {
    const id = gp['id'] as string;
    const stats = ctx.stats.get(id) ?? MemberStatsService.zero();
    const follow = ctx.followState.get(id) ?? { upcomingEventCount: 0, followingEventCount: 0 };
    const club = gp['clubs'] as { name?: string } | null;
    return {
      globalPersonId: id,
      slug: gp['slug'] as string,
      displayName: gp['display_name'] as string,
      photoUrl: (gp['photo_url'] as string | null) ?? null,
      countryCode: (gp['country_code'] as string | null) ?? null,
      clubName: club?.name ?? null,
      favoriteWeapon: ctx.weapons.get(id) ?? null,
      matches: stats.matches,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      eventsAttended: stats.eventsAttended,
      upcomingEventCount: follow.upcomingEventCount,
      followingEventCount: follow.followingEventCount,
    };
  }

  private isVisible(gp: unknown): boolean {
    const row = gp as Record<string, unknown> | null;
    return Boolean(row && !row['deleted_at'] && !row['merged_into_id']);
  }

  private async assertOwner(userId: string, groupId: string): Promise<void> {
    const { data } = await this.supabase.service
      .from('directory_groups')
      .select('id')
      .eq('id', groupId)
      .eq('owner_user_id', userId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Group not found');
  }

  private async countMembers(groupId: string): Promise<number> {
    const { count } = await this.supabase.service
      .from('directory_group_members')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId);
    return count ?? 0;
  }

  private mapGroup(row: Record<string, unknown>, memberCount: number): DirectoryGroup {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      sortOrder: Number(row['sort_order'] ?? 0),
      memberCount,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  /** Map a unique-violation on (owner, lower(name)) to a 409. */
  private translateWriteError(error: { code?: string; message?: string }): Error {
    if (error.code === '23505' || /duplicate key|unique/i.test(error.message ?? '')) {
      return new ConflictException('group_name_in_use');
    }
    return new ConflictException(error.message ?? 'Could not save group');
  }
}
