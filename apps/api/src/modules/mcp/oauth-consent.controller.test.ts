import { UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseService } from '../supabase/supabase.service';
import { OAuthConsentController } from './oauth-consent.controller';
import type { OAuthConsentService } from './oauth-consent.service';

function setup(user: { id: string } | null) {
  const consent = {
    view: vi.fn().mockResolvedValue({ kind: 'expired' }),
    answer: vi.fn().mockResolvedValue({ redirectUrl: 'https://claude.ai/api/mcp/auth_callback' }),
  };
  const supabase = { getAuthUser: vi.fn().mockResolvedValue(user) };
  const controller = new OAuthConsentController(
    consent as unknown as OAuthConsentService,
    supabase as unknown as SupabaseService,
  );
  return { controller, consent, supabase };
}

function request(cookie?: string): FastifyRequest {
  return { headers: {}, cookies: cookie ? { 'sb-access-token': cookie } : {} } as never;
}

describe('OAuthConsentController', () => {
  it("forwards the person's browser login to GoTrue once it is a live one", async () => {
    const { controller, consent, supabase } = setup({ id: 'user-1' });
    await controller.view('abc', request('browser-login'));
    expect(supabase.getAuthUser).toHaveBeenCalledWith('browser-login');
    expect(consent.view).toHaveBeenCalledWith('abc', 'browser-login');

    await controller.answer('abc', { action: 'approve' }, request('browser-login'));
    expect(consent.answer).toHaveBeenCalledWith('abc', 'browser-login', 'approve');
  });

  it('answers 401 signed out, and asks GoTrue nothing', async () => {
    const { controller, consent } = setup(null);
    await expect(controller.view('abc', request())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.answer('abc', { action: 'approve' }, request())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(consent.view).not.toHaveBeenCalled();
    expect(consent.answer).not.toHaveBeenCalled();
  });

  it('answers 401 for a login that no longer verifies', async () => {
    const { controller, consent } = setup(null);
    await expect(controller.view('abc', request('ended-login'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(consent.view).not.toHaveBeenCalled();
  });
});
