/**
 * directory-groups.service.ts
 *
 * Personal collections of global persons (fighters) for the "People" hub.
 * Owner = claimed user. Organizer/bookmark only — no notifications.
 * Member cards reuse compact career stats (MemberStatsService) and the hub
 * follow-state (FollowsService) so the page renders in a couple of round-trips.
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { applyReachable, isReachableEmbed } from '../fighters/directory-predicate';
import { isFieldPublic } from '../fighters/public-visibility';
import { type FollowState, FollowsService } from '../follows/follows.service';
import { SupabaseService } from '../supabase/supabase.service';
import { type CompactStats, MemberStatsService } from './member-stats.service';

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
    id, slug, display_name, photo_url, country_code, public_visibility,
    deleted_at, merged_into_id, account_deleted_at,
    clubs ( name )
  )
`;

@Injectable()
export class DirectoryGroupsService {
  private readonly logger = new Logger(DirectoryGroupsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly memberStats: MemberStatsService,
    private readonly follows: FollowsService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listGroups(userId: string): Promise<DirectoryGroupWithMembers[]> {
    const { data: groups, error: groupsError } = await this.supabase.service
      .from('directory_groups')
      .select('id, name, sort_order, created_at, updated_at')
      .eq('owner_user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (groupsError) throw new Error(`directory groups read failed: ${groupsError.message}`);

    const groupRows = (groups ?? []) as Array<Record<string, unknown>>;
    if (groupRows.length === 0) return [];

    const groupIds = groupRows.map((g) => g['id'] as string);
    const { data: members, error: membersError } = await this.supabase.service
      .from('directory_group_members')
      .select(MEMBER_SELECT)
      .in('group_id', groupIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (membersError) {
      throw new Error(`directory group members read failed: ${membersError.message}`);
    }

    // An erased, deleted or merged profile is never a card (ruling 107).
    const memberRows = ((members ?? []) as Array<Record<string, unknown>>).filter((m) =>
      isReachableEmbed(m['global_persons']),
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
    // The card's own fields come from the lookup, BEFORE the write: after it, only decoration
    // is read, and a failed decoration never fails a saved write (ruling 122).
    const fighter = await this.resolveFighter(input);
    const globalPersonId = fighter['id'] as string;

    // Idempotent insert: ignore a duplicate (already in this group).
    const { error } = await this.supabase.service
      .from('directory_group_members')
      .upsert(
        { group_id: groupId, global_person_id: globalPersonId },
        { onConflict: 'group_id,global_person_id', ignoreDuplicates: true },
      );
    if (error) throw this.translateWriteError(error);

    const ctx = await this.loadCardContext([globalPersonId], userId).catch((err: unknown) => {
      this.logger.warn(
        `Fighter ${globalPersonId} added to group ${groupId}; its card details are unreadable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        stats: new Map<string, CompactStats>(),
        weapons: new Map<string, string | null>(),
        followState: new Map<string, FollowState>(),
      };
    });
    return this.toCard(fighter, ctx);
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

  /**
   * The fighter to add, with the fields of their card. An erased, deleted or merged profile
   * answers as an unknown fighter (ruling 107).
   */
  private async resolveFighter(input: {
    globalPersonId?: string;
    slug?: string;
  }): Promise<Record<string, unknown>> {
    const [column, value] = input.globalPersonId
      ? ['id', input.globalPersonId]
      : ['slug', input.slug as string];
    const { data, error } = await applyReachable(
      this.supabase.service
        .from('global_persons')
        .select(
          'id, slug, display_name, photo_url, country_code, public_visibility, clubs ( name )',
        )
        .eq(column, value),
    ).maybeSingle();
    if (error) throw new Error(`fighter lookup failed: ${error.message}`);
    if (!data) throw new NotFoundException('Fighter not found');
    return data as Record<string, unknown>;
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
      // Only when the fighter's privacy map allows it (ruling 107).
      countryCode: isFieldPublic(gp['public_visibility'], 'nationality')
        ? ((gp['country_code'] as string | null) ?? null)
        : null,
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
