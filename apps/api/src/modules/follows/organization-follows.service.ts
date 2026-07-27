import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Following an ORGANISER.
 *
 * Where FollowsService answers "which fighters do I care about" (and fans out
 * to per-event notification rows), this answers "whose events do I want to
 * hear about". The payoff is a single notification when the organiser
 * publishes — no per-event fan-out, so it needs none of that machinery.
 *
 * Split into its own service rather than added to FollowsService, which is
 * already ~600 lines. The ROUTES still live on FollowsController, which
 * already owns /me/follows* and the cookie identity resolution these need.
 */

export interface FollowedOrganization {
  organizationId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  notifyNewEvent: boolean;
  followedAt: string;
}

/** Cap on a single publish fan-out. See followerUserIds. */
export const MAX_FOLLOWER_FANOUT = 5000;

@Injectable()
export class OrganizationFollowsService {
  private readonly logger = new Logger(OrganizationFollowsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(userId: string): Promise<FollowedOrganization[]> {
    const { data, error } = await this.supabase.service
      .from('organization_follows')
      .select(
        'followed_organization_id, notify_new_event, created_at, organizations(slug, name, logo_url, brand_color)',
      )
      .eq('follower_user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    type Row = {
      followed_organization_id: string;
      notify_new_event: boolean;
      created_at: string;
      // followed_organization_id is a plain FK, so this embeds as an object.
      organizations: {
        slug: string;
        name: string;
        logo_url: string | null;
        brand_color: string | null;
      } | null;
    };

    return (
      ((data ?? []) as unknown as Row[])
        // An org deleted underneath the follow leaves a row with a null embed;
        // skip rather than render a nameless card.
        .filter((row) => row.organizations !== null)
        .map((row) => ({
          organizationId: row.followed_organization_id,
          slug: row.organizations!.slug,
          name: row.organizations!.name,
          logoUrl: row.organizations!.logo_url,
          brandColor: row.organizations!.brand_color,
          notifyNewEvent: row.notify_new_event,
          followedAt: row.created_at,
        }))
    );
  }

  /**
   * Idempotent: following twice is a no-op, not a 409. The FE toggle can fire
   * twice on a double tap and neither press should error.
   */
  async follow(userId: string, organizationId: string): Promise<{ following: true }> {
    const { data: org } = await this.supabase.service
      .from('organizations')
      .select('id, status')
      .eq('id', organizationId)
      .maybeSingle();
    const row = org as { id: string; status: string | null } | null;
    // Mirrors the public page's rule: you can only follow an organisation that
    // is publicly visible in the first place.
    if (!row || row.status !== 'active') {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }

    const { error } = await this.supabase.service
      .from('organization_follows')
      .upsert(
        { follower_user_id: userId, followed_organization_id: organizationId },
        { onConflict: 'follower_user_id,followed_organization_id', ignoreDuplicates: true },
      );
    if (error) throw new BadRequestException(error.message);
    return { following: true };
  }

  /** Also idempotent — unfollowing something you don't follow is a no-op. */
  async unfollow(userId: string, organizationId: string): Promise<{ following: false }> {
    const { error } = await this.supabase.service
      .from('organization_follows')
      .delete()
      .eq('follower_user_id', userId)
      .eq('followed_organization_id', organizationId);
    if (error) throw new BadRequestException(error.message);
    return { following: false };
  }

  async isFollowing(userId: string, organizationId: string): Promise<boolean> {
    const { data } = await this.supabase.service
      .from('organization_follows')
      .select('id')
      .eq('follower_user_id', userId)
      .eq('followed_organization_id', organizationId)
      .limit(1);
    return ((data ?? []) as unknown[]).length > 0;
  }

  async countFollowers(organizationId: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('organization_follows')
      .select('id', { count: 'exact', head: true })
      .eq('followed_organization_id', organizationId);
    if (error) throw new BadRequestException(error.message);
    return count ?? 0;
  }

  /**
   * Recipients for a publish announcement: followers who have not muted this
   * organiser.
   *
   * Hard-capped so one pathological organisation cannot wedge a publish
   * request. Truncation is logged rather than silent — a warn in the log beats
   * followers quietly not being told.
   */
  async followerUserIds(organizationId: string): Promise<string[]> {
    const { data, error } = await this.supabase.service
      .from('organization_follows')
      .select('follower_user_id')
      .eq('followed_organization_id', organizationId)
      .eq('notify_new_event', true)
      .limit(MAX_FOLLOWER_FANOUT + 1);
    if (error) throw new BadRequestException(error.message);

    const ids = ((data ?? []) as Array<{ follower_user_id: string }>).map(
      (row) => row.follower_user_id,
    );
    if (ids.length > MAX_FOLLOWER_FANOUT) {
      this.logger.warn(
        `Organisation ${organizationId} has more than ${MAX_FOLLOWER_FANOUT} followers; truncating the publish fan-out.`,
      );
      return ids.slice(0, MAX_FOLLOWER_FANOUT);
    }
    return ids;
  }
}
