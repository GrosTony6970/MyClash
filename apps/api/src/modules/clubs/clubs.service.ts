import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  BulkClubUpdateDto,
  ClubQueryDto,
  CreateClubDto,
  UpdateClubDto,
} from './dto/clubs.dto';

export interface BulkClubActionResult {
  succeeded: number;
  failed: number;
  errors: { id: string; message: string }[];
}

export type DeleteClubMode = 'safe' | 'archive' | 'cleanup';

const CLUB_LOGO_BUCKET = 'event-assets';
const CLUB_LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_CLUB_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type ClubDeleteBlockers = {
  globalPersons: number;
  eventPersons: number;
  fighterClubLinks: number;
};

export interface ClubLogoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

type ClubReviewStatus = 'pending' | 'approved' | 'linked' | 'rejected' | 'all';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

@Injectable()
export class ClubsService {
  private readonly logger = new Logger(ClubsService.name);
  constructor(private readonly supabase: SupabaseService) {}

  async list(query: ClubQueryDto) {
    let q = this.supabase.service.from('clubs').select('*').order('name', { ascending: true });

    if (!this.booleanQueryValue(query.includeArchived)) {
      q = q.is('archived_at', null) as typeof q;
    }

    if (query.q) {
      q = query.searchAbv
        ? (q.or(`name.ilike.%${query.q}%,abbreviation.ilike.%${query.q}%`) as typeof q)
        : (q.ilike('name', `%${query.q}%`) as typeof q);
    }
    if (query.country) q = q.ilike('country_code', query.country.trim()) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('clubs')
      .select('*')
      .eq('slug', slug)
      .is('archived_at', null)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club "${slug}" not found`);
    return data;
  }

  async create(dto: CreateClubDto) {
    return this.createClubRow(dto, false);
  }

  async createUnverified(dto: CreateClubDto) {
    return this.createClubRow(dto, true);
  }

  private async createClubRow(dto: CreateClubDto, unverified: boolean) {
    const baseSlug = slugify(dto.name);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await this.supabase.service
      .from('clubs')
      .insert({
        name: dto.name.trim(),
        slug,
        abbreviation: dto.abbreviation?.trim().toUpperCase() ?? null,
        city: dto.city ?? null,
        country_code: dto.countryCode?.trim() || null,
        website: dto.website ?? null,
        logo_url: dto.logoUrl ?? null,
        unverified: unverified ? 'true' : 'false',
      })
      .select('*')
      .single();

    if (error) {
      if (error.message.includes('unique')) throw new ConflictException('Club slug already exists');
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async listReviewRequests(status: ClubReviewStatus = 'pending') {
    let query = this.supabase.service
      .from('club_review_requests')
      .select(
        `
        *,
        proposed_club:clubs!club_review_requests_proposed_club_id_fkey(*),
        linked_existing_club:clubs!club_review_requests_linked_existing_club_id_fkey(*),
        event:events(id, name, slug),
        organization:organizations(id, name, slug)
      `,
      )
      .order('created_at', { ascending: false });

    if (status !== 'all') query = query.eq('status', status) as typeof query;

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async approveReviewRequest(id: string) {
    const request = await this.getReviewRequest(id);
    const proposedClubId = request.proposed_club_id;

    const verify = await this.supabase.service
      .from('clubs')
      .update({ unverified: 'false', archived_at: null })
      .eq('id', proposedClubId);
    if (verify.error) throw new BadRequestException(verify.error.message);

    return this.updateReviewRequest(id, {
      status: 'approved',
      review_notes: null,
      updated_at: new Date().toISOString(),
    });
  }

  async linkReviewRequest(id: string, existingClubId: string, notes?: string) {
    const request = await this.getReviewRequest(id);
    await this.getClubById(existingClubId);
    const proposedClubId = request.proposed_club_id;

    const operations = [
      this.supabase.service
        .from('global_persons')
        .update({ club_id: existingClubId })
        .eq('club_id', proposedClubId),
      this.supabase.service
        .from('persons')
        .update({ club_id: existingClubId })
        .eq('club_id', proposedClubId),
      this.supabase.service
        .from('fighter_clubs')
        .update({ club_id: existingClubId })
        .eq('club_id', proposedClubId),
      this.supabase.service
        .from('clubs')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', proposedClubId),
    ];
    const results = await Promise.all(operations);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new BadRequestException(failed.error.message);

    return this.updateReviewRequest(id, {
      status: 'linked',
      linked_existing_club_id: existingClubId,
      review_notes: notes ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  async rejectReviewRequest(id: string, notes?: string) {
    const request = await this.getReviewRequest(id);
    const archive = await this.supabase.service
      .from('clubs')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', request.proposed_club_id);
    if (archive.error) throw new BadRequestException(archive.error.message);

    return this.updateReviewRequest(id, {
      status: 'rejected',
      review_notes: notes ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  async update(id: string, dto: UpdateClubDto) {
    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.abbreviation !== undefined)
      updates['abbreviation'] = dto.abbreviation?.trim().toUpperCase() ?? null;
    if (dto.city !== undefined) updates['city'] = dto.city;
    if (dto.countryCode !== undefined) updates['country_code'] = dto.countryCode.trim() || null;
    if (dto.website !== undefined) updates['website'] = dto.website;
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;

    const { data, error } = await this.supabase.service
      .from('clubs')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club ${id} not found`);
    return data;
  }

  async uploadLogo(id: string, file: ClubLogoUpload): Promise<{ url: string }> {
    await this.getClubById(id);

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > CLUB_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_CLUB_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureBucket();
    const extension = this.extensionFor(file.mimetype);
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `clubs/${id}/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(CLUB_LOGO_BUCKET)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (error) throw new BadRequestException(error.message);

    const { data } = this.supabase.service.storage.from(CLUB_LOGO_BUCKET).getPublicUrl(path);
    await this.update(id, { logoUrl: data.publicUrl });
    return { url: data.publicUrl };
  }

  async deleteLogo(id: string): Promise<{ id: string; logo_url: null }> {
    const { data: club, error: lookupError } = await this.supabase.service
      .from('clubs')
      .select('id, logo_url')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) throw new BadRequestException(lookupError.message);
    if (!club) throw new NotFoundException(`Club ${id} not found`);

    const current = (club as { id: string; logo_url: string | null }).logo_url;
    if (!current) {
      return { id, logo_url: null };
    }

    const prefix = `clubs/${id}`;
    const bucket = this.supabase.service.storage.from(CLUB_LOGO_BUCKET);
    const { data: objects, error: listError } = await bucket.list(prefix);
    if (listError && !/not found/iu.test(listError.message)) {
      throw new BadRequestException(listError.message);
    }
    const keys = (objects ?? [])
      .map((obj) => (obj && typeof obj === 'object' ? (obj as { name?: string }).name : undefined))
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .map((name) => `${prefix}/${name}`);
    if (keys.length > 0) {
      const { error: removeError } = await bucket.remove(keys);
      if (removeError && !/not found/iu.test(removeError.message)) {
        throw new BadRequestException(removeError.message);
      }
    }

    const { data: updated, error: updateError } = await this.supabase.service
      .from('clubs')
      .update({ logo_url: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, logo_url')
      .single();
    if (updateError) throw new BadRequestException(updateError.message);
    return updated as { id: string; logo_url: null };
  }

  async deleteClub(id: string, mode: DeleteClubMode = 'safe') {
    if (!['safe', 'archive', 'cleanup'].includes(mode)) {
      throw new BadRequestException('Unknown club deletion mode');
    }

    if (mode === 'archive') {
      const { error } = await this.supabase.service
        .from('clubs')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw new BadRequestException(error.message);
      return { deleted: false, mode, cleanupApplied: false, archived: true };
    }

    if (mode === 'safe') {
      const blockers = await this.collectClubDeleteBlockers(id);
      if (Object.values(blockers).some((count) => count > 0)) {
        throw new BadRequestException({
          message: 'Club is still referenced and cannot be safely deleted',
          blockers,
        });
      }

      await this.deleteClubRow(id);
      return { deleted: true, mode, cleanupApplied: false, archived: false };
    }

    await this.clearSupportedClubReferences(id);
    await this.deleteClubRow(id);
    return { deleted: true, mode, cleanupApplied: true, archived: false };
  }

  private booleanQueryValue(value: unknown): boolean {
    return value === true || value === 'true';
  }

  private async getClubById(id: string) {
    const { data, error } = await this.supabase.service
      .from('clubs')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club ${id} not found`);
    return data;
  }

  private async getReviewRequest(id: string) {
    const { data, error } = await this.supabase.service
      .from('club_review_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club review request ${id} not found`);
    return data as {
      id: string;
      proposed_club_id: string;
      status: string;
    };
  }

  private async updateReviewRequest(id: string, updates: Record<string, unknown>) {
    const { data, error } = await this.supabase.service
      .from('club_review_requests')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async ensureBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(CLUB_LOGO_BUCKET);
    if (data && !error) return;

    const created = await storage.createBucket(CLUB_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: CLUB_LOGO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_CLUB_LOGO_MIME_TYPES),
    });
    if (created.error && !/already exists/iu.test(created.error.message)) {
      throw new BadRequestException(created.error.message);
    }
  }

  private extensionFor(mimetype: string): 'png' | 'jpg' | 'webp' {
    if (mimetype === 'image/png') return 'png';
    if (mimetype === 'image/webp') return 'webp';
    return 'jpg';
  }

  private async collectClubDeleteBlockers(id: string): Promise<ClubDeleteBlockers> {
    const [globalPersons, eventPersons, fighterClubLinks] = await Promise.all([
      this.countReferences('global_persons', 'club_id', id),
      this.countReferences('persons', 'club_id', id),
      this.countReferences('fighter_clubs', 'club_id', id),
    ]);

    return { globalPersons, eventPersons, fighterClubLinks };
  }

  private async countReferences(table: string, column: string, value: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(column, value);

    if (error) throw new BadRequestException(error.message);
    return count ?? 0;
  }

  private async clearSupportedClubReferences(id: string) {
    const operations = [
      this.supabase.service.from('global_persons').update({ club_id: null }).eq('club_id', id),
      this.supabase.service.from('persons').update({ club_id: null }).eq('club_id', id),
      this.supabase.service.from('fighter_clubs').delete().eq('club_id', id),
    ];

    const results = await Promise.all(operations);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new BadRequestException(failed.error.message);
  }

  private async deleteClubRow(id: string) {
    const { error } = await this.supabase.service.from('clubs').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }

  // ── Verify / Unverify ────────────────────────────────────────────────────
  //
  // `clubs.unverified` is a TEXT column storing 'true' / 'false' (see
  // packages/db/src/schema/fighters.ts). Verifying = writing 'false';
  // unverifying = writing 'true'. We follow the existing convention.

  /**
   * Toggle a single club's verified state. Records the action in the
   * audit log so reviewers can trace who marked a club verified outside
   * the review-request flow.
   */
  async setVerified(id: string, verified: boolean, actorUserId = 'unknown') {
    const { data, error } = await this.supabase.service
      .from('clubs')
      .update({ unverified: verified ? 'false' : 'true' })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Club ${id} not found`);

    await this.writeAuditLog(
      actorUserId,
      verified ? 'club.verify' : 'club.unverify',
      'club',
      id,
      {},
    );
    return data;
  }

  // ── Bulk variants — sequential fan-out over the single-item logic ────────
  //
  // We process ids sequentially (rather than Promise.all) so the audit log
  // ordering matches the request ordering and so partial failures surface as
  // per-row entries instead of throwing the whole batch away. Each method
  // writes one extra batch-level audit row with the success/failure counts.

  async bulkSetVerified(
    ids: readonly string[],
    verified: boolean,
    actorUserId = 'unknown',
  ): Promise<BulkClubActionResult> {
    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of ids) {
      try {
        await this.setVerified(id, verified, actorUserId);
        succeeded += 1;
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Update failed' });
      }
    }
    await this.writeAuditLog(
      actorUserId,
      verified ? 'club.bulk_verify' : 'club.bulk_unverify',
      'club',
      'batch',
      { count: ids.length, succeeded, failed: errors.length },
    );
    return { succeeded, failed: errors.length, errors };
  }

  async bulkArchive(
    ids: readonly string[],
    actorUserId = 'unknown',
  ): Promise<BulkClubActionResult> {
    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of ids) {
      try {
        await this.deleteClub(id, 'archive');
        succeeded += 1;
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Archive failed' });
      }
    }
    await this.writeAuditLog(actorUserId, 'club.bulk_archive', 'club', 'batch', {
      count: ids.length,
      succeeded,
      failed: errors.length,
    });
    return { succeeded, failed: errors.length, errors };
  }

  /**
   * Bulk safe-delete. Rows still referenced by other tables surface as
   * per-row errors rather than aborting the batch (matching the single-item
   * Safe Delete behaviour where a `BadRequestException` is thrown with the
   * blockers payload).
   */
  async bulkSafeDelete(
    ids: readonly string[],
    actorUserId = 'unknown',
  ): Promise<BulkClubActionResult> {
    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of ids) {
      try {
        await this.deleteClub(id, 'safe');
        succeeded += 1;
      } catch (err) {
        const message = extractBlockerMessage(err);
        errors.push({ id, message });
      }
    }
    await this.writeAuditLog(actorUserId, 'club.bulk_safe_delete', 'club', 'batch', {
      count: ids.length,
      succeeded,
      failed: errors.length,
    });
    return { succeeded, failed: errors.length, errors };
  }

  /**
   * Bulk cleanup-delete. Same as the per-row `deleteClub(id, 'cleanup')`:
   * clears supported references (global_persons.club_id, persons.club_id,
   * fighter_clubs) before dropping the row. Failures surface per-row.
   */
  async bulkCleanupDelete(
    ids: readonly string[],
    actorUserId = 'unknown',
  ): Promise<BulkClubActionResult> {
    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of ids) {
      try {
        await this.deleteClub(id, 'cleanup');
        succeeded += 1;
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Cleanup delete failed' });
      }
    }
    await this.writeAuditLog(actorUserId, 'club.bulk_cleanup_delete', 'club', 'batch', {
      count: ids.length,
      succeeded,
      failed: errors.length,
    });
    return { succeeded, failed: errors.length, errors };
  }

  /**
   * Bulk update — applies the same `city`, `countryCode`, and/or `unverified`
   * status across every club in the batch. Refuses the call if none are
   * provided so we never write empty patches. Other fields are deliberately
   * out of scope: name/abbreviation are per-club, slug is immutable, logo
   * has its own endpoints. Bypasses `this.update()` because the legacy
   * `unverified` text column isn't on `UpdateClubDto`; we write directly so
   * one patch covers all three fields. When unverified is set to false
   * (verify), also clears `archived_at` to mirror the single-club verify
   * path at line 150.
   */
  async bulkUpdate(
    ids: readonly string[],
    dto: BulkClubUpdateDto,
    actorUserId = 'unknown',
  ): Promise<BulkClubActionResult> {
    const patch: Record<string, unknown> = {};
    const touched: string[] = [];
    if (dto.city !== undefined) {
      patch['city'] = dto.city;
      touched.push('city');
    }
    if (dto.countryCode !== undefined) {
      patch['country_code'] = dto.countryCode.trim() || null;
      touched.push('country_code');
    }
    if (dto.unverified !== undefined) {
      patch['unverified'] = dto.unverified ? 'true' : 'false';
      if (dto.unverified === false) {
        patch['archived_at'] = null;
      }
      touched.push('unverified');
    }
    if (touched.length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of ids) {
      const { error } = await this.supabase.service.from('clubs').update(patch).eq('id', id);
      if (error) {
        errors.push({ id, message: error.message });
      } else {
        succeeded += 1;
      }
    }
    await this.writeAuditLog(actorUserId, 'club.bulk_update', 'club', 'batch', {
      count: ids.length,
      succeeded,
      failed: errors.length,
      fields: touched,
    });
    return { succeeded, failed: errors.length, errors };
  }

  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(`Could not write audit log for ${action} on ${entityType}:${entityId}`);
    }
  }
}

/**
 * Pulls a human-readable message out of the BadRequestException the safe-
 * delete path throws. The exception carries `response.blockers` plus a
 * `message` string; for partial-failure UI we just want a short reason.
 */
function extractBlockerMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Delete failed';
}
