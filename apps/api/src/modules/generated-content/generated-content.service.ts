import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { AIUsageService } from '../ai-usage/ai-usage.service';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CONTENT_TYPES, type ContentTypeDef } from './content-type.interface';

interface GeneratedRow {
  content_type: string;
  entity_id: string;
  locale: string;
  content: string;
  status: 'draft' | 'published';
  model: string | null;
  generated_at: string;
  published_at: string | null;
}

@Injectable()
export class GeneratedContentService {
  private readonly registry: Map<string, ContentTypeDef>;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly aiUsage: AIUsageService,
    private readonly providers: AIProvidersService,
    private readonly flags: AdminFeatureFlagsService,
    @Inject(CONTENT_TYPES) types: ContentTypeDef[],
  ) {
    this.registry = new Map(types.map((t) => [t.contentType, t]));
  }

  private def(contentType: string): ContentTypeDef {
    const def = this.registry.get(contentType);
    if (!def) throw new NotFoundException(`Unknown content type "${contentType}"`);
    return def;
  }

  /** Generate (or regenerate) content for an entity; stored as a draft. */
  async generate(contentType: string, entityId: string, locale: string, userId: string) {
    const def = this.def(contentType);
    await def.assertAccess(entityId, userId);
    const facts = await def.buildContext(entityId, locale, userId);
    const request = {
      system: def.systemPrompt(locale),
      user: `FACTS:\n${JSON.stringify(facts)}\n\nWrite the content now.`,
      model: 'default',
      maxTokens: 1200,
      temperature: 0.7,
    };

    if (def.keySource === 'org') {
      if (!def.resolveScope) throw new BadRequestException('Org content type is missing a scope');
      const scope = await def.resolveScope(entityId);
      const result = await this.aiUsage.generateWithCap(
        scope.orgId,
        scope.eventId,
        `generated_content:${contentType}`,
        request,
      );
      return this.upsert(def, entityId, locale, result.text, {
        model: result.model ?? null,
        provider: result.provider ?? null,
        costEur: result.costEur,
        userId,
        orgId: scope.orgId,
        eventId: scope.eventId,
      });
    }

    // 'fighter' (per-fighter BYOK): run on the fighter's own key. No org/event
    // budget (their key, their cost), but the global AI kill-switch still wins.
    if (await this.flags.isEnabled('disable_ai_features')) {
      throw new ServiceUnavailableException('AI features are temporarily disabled');
    }
    const result = await this.providers.generateForFighter(
      entityId,
      request,
      `generated_content:${contentType}`,
    );
    return this.upsert(def, entityId, locale, result.text, {
      model: result.model ?? null,
      provider: result.provider ?? null,
      costEur: result.costEur,
      userId,
      orgId: null,
      eventId: null,
    });
  }

  /** Fetch cached content for an authorized viewer (draft or published). */
  async get(contentType: string, entityId: string, locale: string, userId: string) {
    const def = this.def(contentType);
    await def.assertAccess(entityId, userId);
    const row = await this.load(contentType, entityId, locale);
    return row ? this.view(row) : null;
  }

  async setPublished(
    contentType: string,
    entityId: string,
    locale: string,
    userId: string,
    published: boolean,
  ) {
    const def = this.def(contentType);
    if (!def.canPublish) throw new BadRequestException('This content type cannot be published');
    await def.assertAccess(entityId, userId);
    const { data, error } = await this.supabase.service
      .from('ai_generated_content')
      .update({
        status: published ? 'published' : 'draft',
        published_at: published ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('content_type', contentType)
      .eq('entity_id', entityId)
      .eq('locale', locale)
      .select('*')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No generated content to publish');
    return this.view(data as GeneratedRow);
  }

  /**
   * Public read: published content only (no auth). Powers public surfaces.
   * Falls back to the EN copy when the requested locale isn't published, so a
   * viewer still sees a recap the organizer only produced in one language.
   */
  async getPublished(contentType: string, entityId: string, locale: string) {
    const row = await this.load(contentType, entityId, locale);
    if (row && row.status === 'published') return this.view(row);
    if (locale !== 'en') {
      const fallback = await this.load(contentType, entityId, 'en');
      if (fallback && fallback.status === 'published') return this.view(fallback);
    }
    return null;
  }

  private async upsert(
    def: ContentTypeDef,
    entityId: string,
    locale: string,
    content: string,
    meta: {
      model: string | null;
      provider: string | null;
      costEur: number;
      userId: string;
      orgId: string | null;
      eventId: string | null;
    },
  ) {
    const { data, error } = await this.supabase.service
      .from('ai_generated_content')
      .upsert(
        {
          content_type: def.contentType,
          entity_type: def.entityType,
          entity_id: entityId,
          organization_id: meta.orgId,
          event_id: meta.eventId,
          locale,
          content,
          model: meta.model,
          provider: meta.provider,
          cost_eur: meta.costEur,
          status: 'draft',
          generated_by_user_id: meta.userId,
          generated_at: new Date().toISOString(),
          published_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'content_type,entity_id,locale' },
      )
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to store content');
    return this.view(data as GeneratedRow);
  }

  private async load(
    contentType: string,
    entityId: string,
    locale: string,
  ): Promise<GeneratedRow | null> {
    const { data, error } = await this.supabase.service
      .from('ai_generated_content')
      .select('*')
      .eq('content_type', contentType)
      .eq('entity_id', entityId)
      .eq('locale', locale)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return (data as GeneratedRow | null) ?? null;
  }

  private view(row: GeneratedRow) {
    return {
      contentType: row.content_type,
      entityId: row.entity_id,
      locale: row.locale,
      content: row.content,
      status: row.status,
      model: row.model ?? null,
      generatedAt: row.generated_at,
      publishedAt: row.published_at ?? null,
    };
  }
}
