import type { ToolDefinition } from '../ai-providers/adapters/provider-adapter.interface';

export type QueryLanguage = 'en' | 'fr';
export type QueryKind = 'result' | 'clarification' | 'refusal';
export type RenderHint = 'table' | 'list' | 'card' | 'comparison' | 'summary_stats' | 'empty';
export type PhaseFilter = 'pools' | 'elimination' | 'all';
export type FighterStatus = 'active' | 'eliminated' | 'any';
export type MatchStatus = 'pending' | 'in_progress' | 'complete' | 'any';
export type RankMetric = 'wins' | 'win_rate' | 'doubles_rate' | 'afterblow_rate' | 'matches_played';

export interface TournamentToolContext {
  weapons: string[];
  poolIds: string[];
  liceNumbers: number[];
  divisions: string[];
}

export interface TournamentContext extends TournamentToolContext {
  tournamentId: string;
  eventId: string;
  organizationId: string;
  name: string;
  weapon: string | null;
  category: string | null;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  render_hint: RenderHint;
  title: string;
  columns?: string[];
  rows?: Array<Record<string, string | number>>;
  items?: Array<{ label: string; value: string | number }>;
  card?: Record<string, string | number>;
  comparison?: { entities: string[]; metrics: Record<string, Array<string | number>> };
  metadata: {
    tool_name: string;
    arguments: Record<string, unknown>;
    row_count?: number;
    notes?: string[];
  };
}

export interface QueryResponse {
  kind: QueryKind;
  language: QueryLanguage;
  toolCalled?: string;
  result?: ToolResult;
  summary?: string;
  message?: string;
  costEur: number;
  totalSpendEur: number;
}

export interface QueryEstimateResponse {
  estimatedCostEur: number;
  currentSpend: number;
  cap: number | null;
  allowed: boolean;
}

export interface ToolValidationResult {
  ok: boolean;
  message?: string;
}

export type TournamentToolDefinition = ToolDefinition;
