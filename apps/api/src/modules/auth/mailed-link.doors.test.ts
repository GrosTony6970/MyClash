import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { mockSupabase as seededSupabase, writesTo } from '../../common/testing/supabase-chain';
import { OnboardingService } from '../organizations/onboarding.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SignupController } from './signup.controller';

/**
 * From the mail to the door (operator ruling 303).
 *
 * Every older test entered below this seam: it handed a door a code and never asked whether the
 * mailed link carries one. It did not. Each case here takes the link the sender really mailed,
 * reads its address as a browser would, and hands that to the real door.
 */
const ANN = { id: 'user-ann', email: 'ann@example.com' };
const FREE_SLUG = { data: null, error: null };
const CLUB_MADE = { data: { id: 'org-1' }, error: null };
/** What GoTrue answers: its own link, which nothing on our stack serves, and the code. */
const GOTRUE = {
  action_link: 'https://app.myclash.localhost/verify?token=c0de&type=magiclink&redirect_to=x',
  hashed_token: 'c0de',
};

const verifyOtp = vi.fn();
const generateLink = vi.fn();
const sendMagicLink = vi.fn();
const config = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};
const legal = {
  assertCurrent: vi.fn((versions: unknown) => versions),
  recordForUser: vi.fn().mockResolvedValue(undefined),
};

function build(organizations: unknown[] = []) {
  const db = seededSupabase({
    feature_flags: { rows: [{ key: 'admin_lockdown', enabled: false }] },
    platform_roles: { rows: [] },
    global_persons: { rows: [] },
    persons: { rows: [] },
    organizations: organizations as never,
    organization_members: { data: null, error: null },
  });
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: ANN.id } }, error: null });
  const supabase = {
    service: { from: db.service.from, auth: { admin: { generateLink, createUser } } },
    anon: { auth: { verifyOtp } },
  };
  const mail = { sendMagicLink };
  const onboarding = new OnboardingService(
    supabase as never,
    mail as never,
    config as never,
    legal as never,
  );
  const auth = new AuthService(
    supabase as never,
    mail as never,
    config as never,
    {} as never,
    legal as unknown as LegalAcceptanceService,
    {} as never,
  );
  const reply = { setCookie: vi.fn(), clearCookie: vi.fn(), send: vi.fn(), redirect: vi.fn() };
  return {
    db,
    auth,
    onboarding,
    reply,
    signIn: new AuthController(auth),
    signUp: new SignupController(onboarding, auth, supabase as never, legal as never),
  };
}

/** The address of the one mail sent, as the browser that clicks it reads it. */
function clicked(): URL {
  expect(sendMagicLink).toHaveBeenCalledOnce();
  const { magicLink } = sendMagicLink.mock.calls[0]![0] as { magicLink: string };
  expect(magicLink).not.toBe(GOTRUE.action_link);
  return new URL(magicLink);
}

const SIGN_UP = {
  email: ANN.email,
  displayName: 'Ann',
  orgName: 'Lyon AMHE',
  orgSlug: 'lyon-amhe',
  acceptedTerms: 'terms-1',
  acceptedPrivacy: 'privacy-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  generateLink.mockResolvedValue({ data: { properties: GOTRUE }, error: null });
  verifyOtp.mockResolvedValue({
    data: {
      session: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: ANN },
    },
    error: null,
  });
});

describe('a mailed link reaches its door with its code (ruling 303)', () => {
  it('the sign-in mail signs her in and sends her to her personal space', async () => {
    const { auth, signIn, reply } = build();
    await auth.requestMagicLink({ email: ANN.email, type: 'public_login', redirectTo: '/me' });

    const link = clicked();
    expect(link.origin + link.pathname).toBe('https://api.myclash.localhost/api/v1/auth/callback');
    const q = link.searchParams;
    await signIn.callback(
      q.get('token_hash')!,
      q.get('type')!,
      q.get('personId') ?? undefined,
      q.get('next') ?? undefined,
      reply as never,
    );

    // 'email' is the kind GoTrue takes for the code of a new address AND of a known one:
    // asked as 'magiclink', the code of an address with no account yet is refused.
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'c0de', type: 'email' });
    expect(reply.setCookie).toHaveBeenCalledTimes(2);
    expect(reply.redirect).toHaveBeenCalledWith('https://app.myclash.localhost/me');
  });

  it('the sign-up mail signs her in and makes her club', async () => {
    const { onboarding, signUp, reply, db } = build([FREE_SLUG, FREE_SLUG, CLUB_MADE]);
    await onboarding.signup({ ...SIGN_UP, method: 'magic_link' });

    const link = clicked();
    expect(link.origin + link.pathname).toBe(
      'https://admin.myclash.localhost/api/v1/auth/signup-callback',
    );
    const q = link.searchParams;
    await signUp.signupCallback(
      q.get('token_hash')!,
      q.get('orgName')!,
      q.get('orgSlug')!,
      q.get('displayName') ?? undefined,
      q.get('acceptedTerms') ?? undefined,
      q.get('acceptedPrivacy') ?? undefined,
      { cookies: {}, headers: {} } as never,
      reply as never,
    );

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'c0de', type: 'email' });
    expect(writesTo(db, 'organizations').map((write) => write.row)).toEqual([
      { name: 'Lyon AMHE', slug: 'lyon-amhe', status: 'active', created_by_user_id: ANN.id },
    ]);
    expect(legal.recordForUser).toHaveBeenCalledWith(
      ANN.id,
      { terms: 'terms-1', privacy: 'privacy-1' },
      expect.anything(),
    );
    expect(reply.redirect).toHaveBeenCalledWith('/org/lyon-amhe');
  });

  it('the mail of a password sign-up signs her in and sends her to her club', async () => {
    const { onboarding, signIn, reply } = build([FREE_SLUG, CLUB_MADE]);
    await onboarding.signup({ ...SIGN_UP, method: 'password', password: 'Securepassword123!' });

    const q = clicked().searchParams;
    await signIn.callback(
      q.get('token_hash')!,
      q.get('type')!,
      q.get('personId') ?? undefined,
      q.get('next') ?? undefined,
      reply as never,
    );

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'c0de', type: 'email' });
    expect(reply.redirect).toHaveBeenCalledWith('https://admin.myclash.localhost/org/lyon-amhe');
  });
});
