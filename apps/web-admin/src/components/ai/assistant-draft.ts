import type { ReadableDraftAction } from '@myclash/types';

export type DraftType =
  'tournament_config' | 'pool_plan' | 'bracket_plan' | 'schedule_grid' | 'referee_assignments';

/**
 * A draft as the assistant answers it (`mapDraft`, organizer-ai-assistant.service.ts): the
 * assistant page reads it, and the chat's proposal card reads the same answer (call U).
 */
export interface AssistantDraft {
  id: string;
  tournamentId: string | null;
  draftType: DraftType;
  prompt: string;
  summary: string | null;
  /** The actions by name (call U): what the page and the card show. */
  readable: ReadableDraftAction[];
  validationState: { ok?: boolean; warnings?: string[]; errors?: string[] };
  status: 'draft' | 'ready' | 'failed' | 'applied' | 'rejected';
  /** An Apply started: on a `failed` draft, it was partly applied (ruling 997). */
  applyStarted: boolean;
  error: string | null;
  createdAt?: string;
}

/** A `failed` draft whose Apply started: its first actions ran, and it stays as it is. */
export function partlyApplied(draft: Pick<AssistantDraft, 'status' | 'applyStarted'>): boolean {
  return draft.status === 'failed' && draft.applyStarted;
}
