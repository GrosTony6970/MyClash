/**
 * A pluggable AI-generated-content type. Each type knows how to authorize a
 * request, resolve the AI scope (which org/event budget pays), build a grounded
 * facts context, and prompt the model. The GeneratedContentService runs a fixed
 * pipeline over whichever def matches `contentType`.
 */
export interface GenScope {
  orgId: string;
  eventId: string;
}

export interface ContentTypeDef {
  readonly contentType: string; // fighter_insight | tournament_recap | organizer_content
  readonly entityType: string; // global_person | tournament | event
  readonly keySource: 'org' | 'fighter';
  readonly canPublish: boolean;
  /** Org/event whose key + budget pay for the call. Required for org keySource;
   *  omitted for fighter keySource (which uses the fighter's own key). */
  resolveScope?(entityId: string): Promise<GenScope>;
  /** Throws if `userId` may not generate/read this entity's content. */
  assertAccess(entityId: string, userId: string): Promise<void>;
  /** Structured, real facts the model must narrate (never invent). */
  buildContext(entityId: string, locale: string): Promise<Record<string, unknown>>;
  systemPrompt(locale: string): string;
}

/** DI token for the array of registered content-type defs. */
export const CONTENT_TYPES = Symbol('GENERATED_CONTENT_TYPES');
