import type { CompensationPlan } from '@myclash/types';

/**
 * A built-in plan's description in the reader's language (ruling 891). The stored one is the
 * seed's French text (migration 0027), which an English screen showed as it is. Literal keys, by
 * plan name; a plan with no key here keeps its stored description.
 */
const BUILT_IN_DESCRIPTION_KEY: Readonly<Record<string, string>> = {
  FFAMHE: 'organizer.compensationSettings.builtInDescription.ffamhe',
};

export function builtInDescription(
  plan: Pick<CompensationPlan, 'name' | 'description'>,
  t: (key: string) => string,
): string | null {
  const key = BUILT_IN_DESCRIPTION_KEY[plan.name];
  return key ? t(key) : (plan.description ?? null);
}
