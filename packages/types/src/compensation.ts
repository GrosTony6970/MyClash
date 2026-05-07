export type RefereeRole = 'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table';
export type CompensationPhase = 'pool' | 'bracket' | 'finals';

export interface CompensationRoleRate {
  id: string;
  refereeRole: RefereeRole;
  compensationPhase: CompensationPhase;
  tokensPerMatch: number;
}

export interface CompensationTier {
  id: string;
  minTokens: number;
  maxTokens: number | null;
  amount: number;
}

export interface CompensationPlan {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  builtIn: boolean;
  publicVisibility: boolean;
  createdAt: string;
  roleRates: CompensationRoleRate[];
  tiers: CompensationTier[];
}

export interface CompensationEventSettings {
  eventId: string;
  planId: string;
  planName: string;
  maxCompensationAmount: number | null;
}

export interface CompensationBreakdownLine {
  phase: CompensationPhase;
  role: RefereeRole;
  matchCount: number;
  tokensPerMatch: number;
  subtotal: number;
}

export interface RefereeCompensation {
  userId: string;
  displayName: string;
  totalTokens: number;
  amountOwed: number;
  paid: boolean;
  paidAt: string | null;
  breakdown: CompensationBreakdownLine[];
}

export interface CompensationReport {
  planId: string;
  planName: string;
  maxCap: number | null;
  referees: RefereeCompensation[];
  grandTotal: number;
}
