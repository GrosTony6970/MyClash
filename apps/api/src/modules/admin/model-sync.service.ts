import { Injectable } from '@nestjs/common';
import type { AIProvider } from '../ai-providers/adapters/provider-adapter.interface';
import { getModels } from '../ai-providers/model-registry';
import { PlatformAISettingsService } from './platform-ai-settings.service';

export interface ModelSyncReport {
  provider: AIProvider;
  /** Model ids currently in our curated registry for this provider. */
  registered: string[];
  /** Model ids the provider's API currently serves. */
  live: string[];
  /** Live models not in our registry — candidates to add (curated manually). */
  newAtProvider: string[];
  /** Registry models the provider no longer serves — likely retired. */
  missingAtProvider: string[];
}

/**
 * Read-only drift detector: compares the curated `MODEL_REGISTRY` against a
 * provider's live model list. It never mutates the registry — surfacing a new
 * model is still a deliberate edit (pricing/labels stay curated).
 */
@Injectable()
export class ModelSyncService {
  constructor(private readonly settings: PlatformAISettingsService) {}

  async diff(opts: {
    keyId?: string | null;
    providerOverride?: AIProvider | null;
    apiKeyOverride?: string | null;
  }): Promise<ModelSyncReport> {
    const { provider, live } = await this.settings.listLiveModels(opts);
    const registered = getModels(provider).map((m) => m.id);
    const liveSet = new Set(live);
    const registeredSet = new Set(registered);
    return {
      provider,
      registered,
      live,
      newAtProvider: live.filter((id) => !registeredSet.has(id)),
      missingAtProvider: registered.filter((id) => !liveSet.has(id)),
    };
  }
}
