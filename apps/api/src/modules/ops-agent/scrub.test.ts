import { describe, expect, it } from 'vitest';
import { scrubForAgent } from './scrub';

/**
 * What the ops agent may read of a log line (ruling 861: no email, phone or birth date; ruling
 * 868: an IP address keeps its first half). The scrub is a second net: the loggers write no
 * person's field (ruling 867). Names may stay (the design, section 2).
 */
describe('scrubForAgent masks', () => {
  it.each([
    ['an address', 'sent to jean.dupont@example.com', 'sent to [redacted-email]'],
    [
      'an address inside JSON',
      '{"actor_username":"a.b@club.fr","action":"login"}',
      '{"actor_username":"[redacted-email]","action":"login"}',
    ],
    ['a percent-encoded address', 'GET /x?email=a.b%40club.fr', 'GET /x?email=[redacted-email]'],
    [
      'phone numbers',
      'call +33 6 12 34 56 78 or 06.12.34.56.78 or 0033612345678 now',
      'call [redacted-phone] or [redacted-phone] or [redacted-phone] now',
    ],
    ['an IPv4 address', '"remoteAddress":"82.66.103.92"', '"remoteAddress":"82.66.x.x"'],
    ['an IPv6 address', 'from 2a01:e0a:1f2:3b40::5 ok', 'from 2a01:e0a:x ok'],
    [
      'a full IPv6 address',
      'from 2a01:0e0a:01f2:3b40:0000:0000:0000:0005 ok',
      'from 2a01:0e0a:x ok',
    ],
    [
      'an IPv4 address inside IPv6',
      '"remoteAddress":"::ffff:82.66.103.92"',
      '"remoteAddress":"::ffff:82.66.x.x"',
    ],
    [
      'a pass code in a path',
      '/api/v1/event-passes/AbC123xyz/qr',
      '/api/v1/event-passes/[token]/qr',
    ],
    [
      "a pass code in Traefik's line",
      '"GET /api/v1/event-passes/CODE123 HTTP/2.0" 200',
      '"GET /api/v1/event-passes/[token] HTTP/2.0" 200',
    ],
    [
      'a link secret in a query',
      '/auth/v1/verify?token=abc123&type=magiclink',
      '/auth/v1/verify?token=[redacted]&type=magiclink',
    ],
    [
      'the other link secrets',
      '?token_hash=a1&code=b2&access_token=c3&refresh_token=d4&apikey=e5',
      '?token_hash=[redacted]&code=[redacted]&access_token=[redacted]&refresh_token=[redacted]&apikey=[redacted]',
    ],
    [
      'an IPv4 address that ends a sentence',
      'banned 82.66.103.92. Next.',
      'banned 82.66.x.x. Next.',
    ],
    [
      "an event pass's own parameter",
      '/e/fal-2026/pass?t=PassCode123',
      '/e/fal-2026/pass?t=[redacted]',
    ],
    [
      'a secret after an ampersand Go wrote as \\u0026',
      '"referer":"https://app.myclash.fr/x?a=1\\u0026token=SECRET1"',
      '"referer":"https://app.myclash.fr/x?a=1\\u0026token=[redacted]"',
    ],
    [
      "a pre-signed storage link's secrets",
      '?X-Amz-Credential=AKIA1&X-Amz-Signature=abc123&X-Amz-Security-Token=tok&X-Amz-Expires=300',
      '?X-Amz-Credential=[redacted]&X-Amz-Signature=[redacted]&X-Amz-Security-Token=[redacted]&X-Amz-Expires=300',
    ],
    [
      'a password in a connection string',
      'postgres://supabase_admin:s3cret@db:5432/postgres',
      'postgres://[redacted]@db:5432/postgres',
    ],
  ])('%s', (_, input, expected) => {
    expect(scrubForAgent(input)).toBe(expected);
  });

  it('a bearer token and a JWT', () => {
    const out = scrubForAgent('Authorization: Bearer eyJhbGciOi.eyJzdWIi.c2ln and eyJa.eyJb.c2ln');
    expect(out).not.toContain('eyJ');
  });
});

describe('scrubForAgent leaves alone', () => {
  it.each([
    ['a timestamp', '2026-11-18T23:34:35.123456789Z'],
    ['a pino line', '{"level":30,"time":1795044825752,"responseTime":2.178821001201868}'],
    ['a small decimal', '"responseTime":0.00912345678'],
    ['a digest', 'sha256:0012345678abcd'],
    ['a SQL cast', "where id = $1::uuid and d = '1'::date"],
    [
      'a Nest line',
      '[Nest] 1  - 11/19/2026, 12:34:35 AM    WARN [AuthGuard] auth-shadow would-401',
    ],
    ['a UUID', 'user bc1c32e0-25b6-4a1f-9c3e-0123456789ab'],
    ['a route', 'Mapped {/health, GET} route +7ms'],
    ['a time of day', 'at 23:34:35 and 05:00'],
    ['a line already masked', '{"path":"/api/v1/event-passes/[token]","statusCode":200}'],
  ])('%s', (_, input) => {
    expect(scrubForAgent(input)).toBe(input);
  });

  it("only the address in Traefik's access line", () => {
    const line =
      '172.18.0.12 - - [18/Nov/2026:23:34:33 +0000] "GET /rest/v1/events HTTP/2.0" 200 2 "-" "-" ' +
      '50792 "myclash-rest@docker" "http://172.18.0.8:3000" 24ms';
    expect(scrubForAgent(line)).toBe(
      '172.18.x.x - - [18/Nov/2026:23:34:33 +0000] "GET /rest/v1/events HTTP/2.0" 200 2 "-" "-" ' +
        '50792 "myclash-rest@docker" "http://172.18.x.x:3000" 24ms',
    );
  });
});
