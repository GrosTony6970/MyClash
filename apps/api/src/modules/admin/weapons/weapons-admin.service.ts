import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { slugify } from '../../fighters/weapon-import.util';
import type { CreateWeaponDto, UpdateWeaponDto } from './dto/weapons-admin.dto';

export interface WeaponCatalogRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeaponCatalogListItem extends WeaponCatalogRow {
  /** Number of fighter profiles referencing this weapon (via fighter_weapons). */
  usageCount: number;
}

/**
 * Super-admin CRUD over the shared `weapon_catalog` (created + seeded in
 * migration 0017, curated in 0132). Tournaments and workshops pick their
 * weapon strictly from the active entries here; the public picker reads via
 * `GET /api/v1/weapons?active=true`.
 *
 * Removal is soft by default (toggle `active`), with a guarded hard delete
 * that cascades to `fighter_weapons` (ON DELETE CASCADE, migration 0017) —
 * hence the usage count surfaced by {@link list}.
 */
@Injectable()
export class WeaponsAdminService {
  private readonly logger = new Logger(WeaponsAdminService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(): Promise<WeaponCatalogListItem[]> {
    const { data: weapons, error } = await this.supabase.service
      .from('weapon_catalog')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const rows = (weapons ?? []) as WeaponCatalogRow[];

    // Count fighter references per weapon with exact HEAD counts (one small
    // count query per catalog entry, ~25 total). A single unbounded
    // .select('weapon_id') would silently truncate at the PostgREST max-rows
    // cap (~1000) and undercount usage — the figure the super-admin relies on
    // to judge whether a cascading hard-delete is safe.
    return Promise.all(
      rows.map(async (w) => {
        const { count, error: countError } = await this.supabase.service
          .from('fighter_weapons')
          .select('*', { count: 'exact', head: true })
          .eq('weapon_id', w.id);
        if (countError) throw new BadRequestException(countError.message);
        return { ...w, usageCount: count ?? 0 };
      }),
    );
  }

  async create(dto: CreateWeaponDto, actorUserId: string): Promise<WeaponCatalogRow> {
    const name = dto.name.trim();
    const slug = slugify(name);
    if (!slug) {
      throw new BadRequestException('Weapon name must contain at least one letter or digit');
    }
    // Dedupe by NAME (the feature's identity key), not just slug: strict
    // tournament/workshop validation resolves by name, and a renamed entry can
    // keep a slug that no longer matches slugify(name), so a slug-only guard
    // would let two same-named rows coexist.
    await this.assertNameAvailable(name);

    const { data, error } = await this.supabase.service
      .from('weapon_catalog')
      .insert({ name, slug, active: true })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
        throw new ConflictException(`A weapon with slug "${slug}" already exists`);
      }
      throw new BadRequestException(error.message);
    }

    const row = data as WeaponCatalogRow;
    await this.writeAuditLog(actorUserId, 'weapon_catalog.created', row.id, {
      slug: row.slug,
      name: row.name,
    });
    return row;
  }

  async update(id: string, dto: UpdateWeaponDto, actorUserId: string): Promise<WeaponCatalogRow> {
    const existing = await this.getById(id);

    // Renaming to a name another entry already uses would create a same-name
    // duplicate (validation resolves by name), so guard it here too.
    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameAvailable(dto.name, id);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    // Slug stays immutable (it's the stable key fighter imports resolve by) —
    // only the display name and active flag are editable.
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.active !== undefined) updates['active'] = dto.active;

    const { data, error } = await this.supabase.service
      .from('weapon_catalog')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);

    const row = data as WeaponCatalogRow;
    await this.writeAuditLog(actorUserId, 'weapon_catalog.updated', row.id, {
      slug: row.slug,
      name: row.name,
      active: row.active,
      changedFields: Object.keys(updates).filter((k) => k !== 'updated_at'),
      from_name: existing.name,
    });
    return row;
  }

  async delete(id: string, actorUserId: string): Promise<void> {
    const existing = await this.getById(id);

    // Hard delete. fighter_weapons cascades via FK ON DELETE CASCADE
    // (migration 0017). Existing tournaments/workshops keep their stored
    // free-text weapon name — only the catalog row and fighter links go.
    const { error } = await this.supabase.service.from('weapon_catalog').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'weapon_catalog.deleted', id, {
      slug: existing.slug,
      name: existing.name,
    });
  }

  /**
   * Throw ConflictException if another catalog row already uses `name`
   * (case-insensitive, trimmed). `exceptId` excludes the row being renamed.
   * The catalog is tiny (~25 rows), so a full fetch + JS compare is cheap and
   * avoids ilike wildcard pitfalls.
   */
  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const wanted = name.trim().toLowerCase();
    const { data, error } = await this.supabase.service.from('weapon_catalog').select('id, name');
    if (error) throw new BadRequestException(error.message);
    const clash = ((data ?? []) as Array<{ id: string; name: string }>).find(
      (r) => r.name.trim().toLowerCase() === wanted && r.id !== exceptId,
    );
    if (clash) {
      throw new ConflictException(`A weapon named "${name.trim()}" already exists`);
    }
  }

  private async getById(id: string): Promise<WeaponCatalogRow> {
    const { data, error } = await this.supabase.service
      .from('weapon_catalog')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Weapon ${id} not found`);
    return data as WeaponCatalogRow;
  }

  /**
   * Audit-log helper — mirrors LeagueScoringSystemsService.writeAuditLog:
   * swallow errors so audit logging never blocks the primary action.
   */
  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: actorUserId,
        action,
        entity_type: 'weapon_catalog',
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(`Could not write audit log for ${action} on weapon_catalog:${entityId}`);
    }
  }
}
