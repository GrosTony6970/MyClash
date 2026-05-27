import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: sendMock,
    },
  })),
}));

import { MailService } from './mail.service';

const config = {
  getOrThrow: vi.fn(() => 'resend-key'),
  get: vi.fn((key: string, fallback?: string) => {
    const values: Record<string, string> = {
      MAIL_FROM: 'noreply@myclash.fr',
    };
    return values[key] ?? fallback ?? '';
  }),
};

const supabase = {
  service: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  },
};

describe('MailService email-change confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ data: { id: 'mail-1' }, error: null });
  });

  it('sends confirmation to the new email with bilingual copy and escaped values', async () => {
    const service = new MailService(config as never, supabase as never);

    await service.sendEmailChangeConfirmation({
      to: 'new@example.com',
      oldEmail: 'old@example.com',
      newEmail: 'new@example.com',
      confirmUrl: 'https://api.myclash.fr/api/v1/persons/me/email-change/confirm?token=abc',
      expiresAt: '2026-05-06T16:00:00.000Z',
      displayName: '<Jean & Marie>',
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@myclash.fr',
        to: 'new@example.com',
        subject: expect.stringContaining('email'),
      }),
    );

    const html = sendMock.mock.calls[0]![0].html as string;
    expect(html).toContain('Confirmer le changement');
    expect(html).toContain('Confirm email change');
    expect(html).toContain('new@example.com');
    expect(html).toContain('old@example.com');
    expect(html).toContain(
      'https://api.myclash.fr/api/v1/persons/me/email-change/confirm?token=abc',
    );
    expect(html).toContain('&lt;Jean &amp; Marie&gt;');
    expect(html).not.toContain('<Jean & Marie>');
    // Header now carries both the logo image and the wordmark text.
    expect(html).toContain(
      '<img src="https://myclash.fr/brand/Logomini_nobackground.png" alt="MyClash"',
    );
    expect(html).toContain('MyClash');
  });

  it('sends escaped bilingual organizer broadcast emails with severity label', async () => {
    const service = new MailService(config as never, supabase as never);

    await service.sendBroadcastNotification({
      to: 'person@example.com',
      subject: 'Venue <change>',
      title: 'Venue <change>',
      body: 'Use hall & entrance B',
      actionUrl: 'https://app.myclash.fr/notifications',
      severity: 'alert',
    });

    const html = sendMock.mock.calls[0]![0].html as string;
    expect(html).toContain('Alerte / Alert');
    expect(html).toContain('Venue &lt;change&gt;');
    expect(html).toContain('Use hall &amp; entrance B');
    expect(html).toContain('Message envoye');
    expect(html).toContain('Message sent');
    expect(html).not.toContain('Venue <change>');
    expect(html).toContain(
      '<img src="https://myclash.fr/brand/Logomini_nobackground.png" alt="MyClash"',
    );
  });

  it('honours MAIL_LOGO_URL override when set in config', async () => {
    const customConfig = {
      getOrThrow: vi.fn(() => 'resend-key'),
      get: vi.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          MAIL_FROM: 'noreply@myclash.fr',
          MAIL_LOGO_URL: 'https://cdn.example.com/brand/logo.png',
        };
        return values[key] ?? fallback ?? '';
      }),
    };
    const service = new MailService(customConfig as never, supabase as never);

    await service.sendBroadcastNotification({
      to: 'person@example.com',
      subject: 'Test',
      title: 'Test',
      body: 'Test body',
      severity: 'info',
    });

    const html = sendMock.mock.calls[0]![0].html as string;
    expect(html).toContain('<img src="https://cdn.example.com/brand/logo.png" alt="MyClash"');
    expect(html).not.toContain('myclash.fr/brand');
  });

  it('falls back to DOMAIN-derived logo URL when DOMAIN is set but MAIL_LOGO_URL is not', async () => {
    const stagingConfig = {
      getOrThrow: vi.fn(() => 'resend-key'),
      get: vi.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          MAIL_FROM: 'noreply@staging.myclash.fr',
          DOMAIN: 'staging.myclash.fr',
        };
        return values[key] ?? fallback ?? '';
      }),
    };
    const service = new MailService(stagingConfig as never, supabase as never);

    await service.sendBroadcastNotification({
      to: 'person@example.com',
      subject: 'Test',
      title: 'Test',
      body: 'Test body',
      severity: 'info',
    });

    const html = sendMock.mock.calls[0]![0].html as string;
    expect(html).toContain('<img src="https://staging.myclash.fr/brand/Logomini_nobackground.png"');
  });
});
