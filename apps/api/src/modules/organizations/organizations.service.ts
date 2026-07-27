import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { SupabaseService } from '../supabase/supabase.service';
// Value import ON PURPOSE — `import type` erases DI metadata and @Optional()
// silently injects undefined (see matches/di-wiring.regression.test.ts).
import { UserDirectoryService } from '../user-directory/user-directory.service';
import type {
  AddMemberDto,
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organizations.dto';

/** Page size for the public organiser directory, and its hard cap. */
const DEFAULT_PUBLIC_ORG_PAGE = 24;
const MAX_PUBLIC_ORG_PAGE = 50;

const ORG_LOGO_BUCKET = 'event-assets';
const ORG_LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_ORG_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface OrgLogoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly supabase: SupabaseService,
    // Optional so direct `new OrganizationsService(supabase)` in tests still
    // works; provided by OrganizationsModule (imports UserDirectoryModule).
    @Optional() private readonly userDirectory?: UserDirectoryService,
  ) {}

  // ── List (super admin) ───────────────────────────────────────────────────────

  async list() {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('*, organization_members(user_id, role)')
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Get one ──────────────────────────────────────────────────────────────────

  async getById(id: string) {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('*, organization_members(user_id, role, created_at)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Organization ${id} not found`);
    return data;
  }

  async getBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id, name, slug, status, logo_url, brand_color, contact_email')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Organization "${slug}" not found`);
    return data;
  }

  /**
   * Public organiser profile, for /o/[slug].
   *
   * A SEPARATE method rather than opening getBySlug up: that one returns
   * contact_email and status, and neither belongs on an anonymous surface.
   * This projects only what the public page renders.
   *
   * 404s unless the org is active — a pending_approval or suspended
   * organisation must not get an indexable public page.
   */
  async getPublicBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id, name, slug, logo_url, brand_color, status')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    const org = data as {
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      brand_color: string | null;
      status: string | null;
    } | null;
    // Same 404 for "no such org" and "not active", so the endpoint doesn't
    // become a probe for which organisations exist but are unapproved.
    if (!org || org.status !== 'active') {
      throw new NotFoundException(`Organization "${slug}" not found`);
    }

    // Aggregate only. Read through the service key precisely so the count can
    // be public while the follower LIST stays owner-only under RLS — who
    // follows an organiser is nobody else's business.
    const { count } = await this.supabase.service
      .from('organization_follows')
      .select('id', { count: 'exact', head: true })
      .eq('followed_organization_id', org.id);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logo_url,
      brandColor: org.brand_color,
      followerCount: count ?? 0,
    };
  }

  /**
   * Anonymous organiser directory, for /organisers.
   *
   * Same `status='active'` rule as getPublicBySlug, so the list can never
   * surface an organisation whose profile page would 404.
   *
   * Ordered by NAME, deliberately. Sorting by activity or follower count means
   * counting every active organisation before you can paginate — the counts
   * live in other tables, so Postgres cannot order by them without a
   * denormalised column or an RPC. Alphabetical is stable, cheap, and
   * paginates correctly.
   *
   * The two count queries are batched over the page's ids rather than run per
   * row: a page of 24 organisations costs 3 queries, not 49.
   */
  async listPublic(query: { q?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(query.limit ?? DEFAULT_PUBLIC_ORG_PAGE, MAX_PUBLIC_ORG_PAGE);
    const offset = query.offset ?? 0;

    let q = this.supabase.service
      .from('organizations')
      .select('id, name, slug, logo_url, brand_color', { count: 'exact' })
      .eq('status', 'active')
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    // Sanitised even though this is a single filter param rather than an
    // .or() list — PostgREST meta-characters have no business in a name search.
    const term = query.q ? sanitizePostgrestFilterValue(query.q) : '';
    if (term) q = q.ilike('name', `%${term}%`) as typeof q;

    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      brand_color: string | null;
    }>;
    const total = count ?? 0;
    if (rows.length === 0) return { items: [], total };

    const ids = rows.map((row) => row.id);
    const [followerCounts, upcomingCounts] = await Promise.all([
      this.countFollowersByOrg(ids),
      this.countUpcomingEventsByOrg(ids),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        logoUrl: row.logo_url,
        brandColor: row.brand_color,
        followerCount: followerCounts.get(row.id) ?? 0,
        upcomingEventCount: upcomingCounts.get(row.id) ?? 0,
      })),
      total,
    };
  }

  /**
   * Follower counts for a page of organisations, as one query.
   *
   * Aggregate only — the same reasoning as getPublicBySlug: the COUNT is
   * public, the follower LIST stays owner-only under RLS.
   */
  private async countFollowersByOrg(orgIds: string[]): Promise<Map<string, number>> {
    const { data, error } = await this.supabase.service
      .from('organization_follows')
      .select('followed_organization_id')
      .in('followed_organization_id', orgIds);
    if (error) throw new BadRequestException(error.message);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ followed_organization_id: string }>) {
      counts.set(row.followed_organization_id, (counts.get(row.followed_organization_id) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * "Events you could still attend" per organisation: published + running,
   * test events excluded. Mirrors what the public event list treats as
   * upcoming, so the number on a directory card matches what /o/[slug] shows.
   */
  private async countUpcomingEventsByOrg(orgIds: string[]): Promise<Map<string, number>> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .in('organization_id', orgIds)
      .in('status', ['published', 'running'])
      .eq('is_test_event', false);
    if (error) throw new BadRequestException(error.message);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ organization_id: string }>) {
      counts.set(row.organization_id, (counts.get(row.organization_id) ?? 0) + 1);
    }
    return counts;
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  // Creates with status='pending_approval' per T-105 AC.
  // (T-009b creates with status='active' for self-service signup — different path)

  async dashboardStats(orgId: string, userId: string) {
    await this.assertOrgRole(orgId, userId, 'scorekeeper');

    const { data: events, error: eventsError } = await this.supabase.service
      .from('events')
      .select('id, start_date')
      .eq('organization_id', orgId);
    if (eventsError) throw new BadRequestException(eventsError.message);

    const eventRows = (events ?? []) as Array<{ id: string; start_date?: string | null }>;
    const eventIds = eventRows.map((event) => event.id);
    const today = new Date().toISOString().slice(0, 10);
    const upcomingEvents = eventRows.filter((event) => (event.start_date ?? '') >= today).length;

    let tournamentsTotal = 0;
    let fighterParticipations = 0;
    let refereeParticipations = 0;

    if (eventIds.length > 0) {
      const { data: tournaments, error: tournamentsError } = await this.supabase.service
        .from('tournaments')
        .select('id')
        .in('event_id', eventIds);
      if (tournamentsError) throw new BadRequestException(tournamentsError.message);

      const tournamentIds = ((tournaments ?? []) as Array<{ id: string }>).map(
        (tournament) => tournament.id,
      );
      tournamentsTotal = tournamentIds.length;

      if (tournamentIds.length > 0) {
        const { data: registrations, error: registrationsError } = await this.supabase.service
          .from('registrations')
          .select('id')
          .in('tournament_id', tournamentIds);
        if (registrationsError) throw new BadRequestException(registrationsError.message);
        fighterParticipations = (registrations ?? []).length;
      }

      const { data: referees, error: refereesError } = await this.supabase.service
        .from('referee_qualifications')
        .select('id')
        .eq('active', true)
        .in('event_id', eventIds);
      if (refereesError) throw new BadRequestException(refereesError.message);
      refereeParticipations = (referees ?? []).length;
    }

    return {
      eventsTotal: eventRows.length,
      upcomingEvents,
      tournamentsTotal,
      fighterParticipations,
      refereeParticipations,
    };
  }

  async create(dto: CreateOrganizationDto, createdByUserId: string) {
    // Check slug uniqueness
    const { data: existing } = await this.supabase.service
      .from('organizations')
      .select('id')
      .eq('slug', dto.slug)
      .maybeSingle();

    if (existing) throw new ConflictException(`Slug "${dto.slug}" is already taken`);

    const { data, error } = await this.supabase.service
      .from('organizations')
      .insert({
        name: dto.name.trim(),
        slug: dto.slug,
        contact_email: dto.contactEmail ?? null,
        status: 'pending_approval',
        created_by_user_id: createdByUserId,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Auto-add creator as owner
    await this.supabase.service.from('organization_members').insert({
      organization_id: (data as { id: string }).id,
      user_id: createdByUserId,
      role: 'owner',
    });

    return data;
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateOrganizationDto, userId: string) {
    await this.assertOrgRole(id, userId, 'owner');

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.contactEmail !== undefined) updates['contact_email'] = dto.contactEmail;
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;
    if (dto.brandColor !== undefined) updates['brand_color'] = dto.brandColor;

    const { data, error } = await this.supabase.service
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async uploadLogo(id: string, userId: string, file: OrgLogoUpload): Promise<{ url: string }> {
    await this.assertOrgRole(id, userId, 'admin');

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > ORG_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_ORG_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureLogoBucket();
    const extension =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `organizations/${id}/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(ORG_LOGO_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new BadRequestException(error.message);

    // Same-origin relative path — the IMG resolves to whichever
    // admin/app origin loaded the bundle, sidestepping the
    // cross-origin app.${DOMAIN} roundtrip Supabase's getPublicUrl
    // would have produced. Traefik routes /storage/v1/* to
    // supabase-storage on both app.${DOMAIN} and admin.${DOMAIN}.
    const url = `/storage/v1/object/public/${ORG_LOGO_BUCKET}/${path}`;

    const { error: updateError } = await this.supabase.service
      .from('organizations')
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) throw new BadRequestException(updateError.message);

    return { url };
  }

  private async ensureLogoBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(ORG_LOGO_BUCKET);
    if (data && !error) return;
    const created = await storage.createBucket(ORG_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: ORG_LOGO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_ORG_LOGO_MIME_TYPES),
    });
    if (created.error && !/already exists/iu.test(created.error.message)) {
      throw new BadRequestException(created.error.message);
    }
  }

  // ── Members ──────────────────────────────────────────────────────────────────

  /** Members with resolved display names (never raw UUIDs) — org admin+. */
  async listMembers(orgId: string, requestingUserId: string) {
    await this.assertOrgRole(orgId, requestingUserId, 'admin');

    const { data, error } = await this.supabase.service
      .from('organization_members')
      .select('user_id, role, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const rows = (data ?? []) as Array<{ user_id: string; role: string; created_at: string }>;
    const resolved =
      (await this.userDirectory?.resolveUsers(rows.map((row) => row.user_id))) ??
      new Map<string, { name: string | null; email: string | null }>();
    return rows.map((row) => ({
      userId: row.user_id,
      role: row.role,
      createdAt: row.created_at,
      name: resolved.get(row.user_id)?.name ?? null,
      email: resolved.get(row.user_id)?.email ?? null,
    }));
  }

  async addMember(orgId: string, dto: AddMemberDto, requestingUserId: string) {
    await this.assertOrgRole(orgId, requestingUserId, 'owner');

    // Owner-friendly path: resolve an existing account by email — owners
    // don't know their teammates' UUIDs (and the UI never shows raw ids).
    let userId = dto.userId ?? null;
    if (!userId) {
      if (!dto.email) throw new BadRequestException('Provide userId or email');
      userId = await this.findUserIdByEmail(dto.email);
      if (!userId) {
        throw new NotFoundException(
          `No MyClash account found for ${dto.email}. Ask them to sign up first.`,
        );
      }
    }

    // Super-admins are platform-scoped; they must not appear in any org's
    // member list. Mirror check in AdminUsersService.addOrgMembership.
    await this.assertNotSuperAdmin(userId);

    const { data, error } = await this.supabase.service
      .from('organization_members')
      .upsert({
        organization_id: orgId,
        user_id: userId,
        role: dto.role,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /** Remove a member — owner only; the owner row itself is untouchable. */
  async removeMember(orgId: string, targetUserId: string, requestingUserId: string) {
    await this.assertOrgRole(orgId, requestingUserId, 'owner');

    const { data: target } = await this.supabase.service
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (!target) throw new NotFoundException('Member not found in this organization');
    if ((target as { role: string }).role === 'owner') {
      throw new BadRequestException(
        'The owner cannot be removed — reassign ownership first (super admin).',
      );
    }

    const { error } = await this.supabase.service
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', targetUserId);
    if (error) throw new BadRequestException(error.message);
    return { removed: true };
  }

  /** Paged GoTrue admin scan — same approach as admin-organizations. */
  private async findUserIdByEmail(email: string): Promise<string | null> {
    const target = email.trim().toLowerCase();
    let page = 1;
    const perPage = 1000;
    while (page <= 10) {
      const response = await this.supabase.listAuthAdminUsers(page, perPage);
      if (!response.ok || !response.data) {
        throw new BadRequestException('Could not look up accounts by email');
      }
      const user = response.data.users.find(
        (candidate) => candidate.email?.toLowerCase() === target,
      );
      if (user) return user.id;
      if (response.data.users.length < perPage) return null;
      page += 1;
    }
    return null;
  }

  /** Throws if `userId` holds the platform-level super-admin role. */
  private async assertNotSuperAdmin(userId: string) {
    const { data } = await this.supabase.service
      .from('platform_roles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();
    if (data) {
      throw new ForbiddenException(
        'Cannot add a super-admin to an organization. Revoke super-admin status first.',
      );
    }
  }

  // ── Helper: assert org role ──────────────────────────────────────────────────

  async assertOrgRole(
    orgId: string,
    userId: string,
    minRole:
      | 'owner'
      | 'admin'
      | 'editor'
      | 'scorekeeper'
      | 'referee'
      | 'workshop_lead'
      | 'read_only',
  ) {
    const { data } = await this.supabase.service
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) throw new ForbiddenException('You are not a member of this organization');

    const roleHierarchy = [
      'read_only',
      'scorekeeper',
      'referee',
      'workshop_lead',
      'editor',
      'admin',
      'owner',
    ];
    const memberRole = (data as { role: string }).role;
    if (roleHierarchy.indexOf(memberRole) < roleHierarchy.indexOf(minRole)) {
      throw new ForbiddenException(`Requires ${minRole} role or higher`);
    }
  }
}
