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

describe('MailService email-change confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ data: { id: 'mail-1' }, error: null });
  });

  it('sends confirmation to the new email with bilingual copy and escaped values', async () => {
    const service = new MailService(config as never);

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
  });

  it('sends escaped bilingual organizer broadcast emails with severity label', async () => {
    const service = new MailService(config as never);

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
  });
});
