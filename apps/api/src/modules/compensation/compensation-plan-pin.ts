import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * Whether an Event of `organizationId` may use a referee compensation plan
 * (operator ruling 69): the built-in, a shared plan, or one that organisation
 * owns — the penalty pin's rule (rulings 64, 66). The Event's pay report
 * computes with the plan's rates and tiers, so another organisation's private
 * plan would hand them over. A missing plan is not usable either. The one
 * owner for the settings save and for archive restore. A failed read throws:
 * it is not a verdict.
 *
 * Not closed: RLS `rces_write` lets an org admin write `plan_id` straight
 * through PostgREST, and ruling 69 chose no database trigger for it.
 */
export async function pinnableCompensationPlan(
  supabase: SupabaseService,
  planId: string,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await supabase.service
    .from('referee_compensation_plans')
    .select('organization_id, built_in, public_visibility')
    .eq('id', planId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const plan = data as {
    organization_id?: string | null;
    built_in?: boolean;
    public_visibility?: boolean;
  } | null;
  return Boolean(
    plan && (plan.built_in || plan.public_visibility || plan.organization_id === organizationId),
  );
}
