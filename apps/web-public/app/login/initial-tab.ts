export type Tab = 'signin' | 'signup' | 'reset';

/**
 * The tab the sign-in page opens on, from its `?tab=`. The "Forgot password?" of a spent sign-up
 * link opens the reset tab (choose-password); a Workshop page's "Create an account" opens the
 * sign-up tab (ruling 568). Anything else opens sign-in.
 */
export function initialTab(asked: unknown): Tab {
  return asked === 'reset' || asked === 'signup' ? asked : 'signin';
}
