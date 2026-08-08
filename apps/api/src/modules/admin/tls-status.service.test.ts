import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminTlsStatusService,
  deriveCaType,
  deriveHealth,
  type PeerCertLike,
} from './tls-status.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, def?: unknown) => (key in overrides ? overrides[key] : def),
  } as unknown as ConfigService;
}

const DAY = 86_400_000;
function certExpiringIn(days: number, issuerOrg = "Let's Encrypt"): PeerCertLike {
  return {
    valid_from: new Date(Date.now() - 30 * DAY).toUTCString(),
    valid_to: new Date(Date.now() + days * DAY).toUTCString(),
    issuer: { O: issuerOrg, CN: 'R10' },
    subject: { CN: 'app.myclash.fr' },
  };
}

describe('deriveCaType', () => {
  it('classifies the LE staging issuer as staging (staging wins over prod)', () => {
    expect(deriveCaType("(STAGING) Let's Encrypt", '(STAGING) Pretend Pear X1')).toBe('staging');
  });
  it('classifies the LE production issuer as prod', () => {
    expect(deriveCaType("Let's Encrypt", 'R10')).toBe('prod');
    expect(deriveCaType('LetsEncrypt', 'E5')).toBe('prod');
  });
  it('classifies anything else (e.g. Traefik default cert) as unknown', () => {
    expect(deriveCaType('TRAEFIK DEFAULT CERT', undefined)).toBe('unknown');
    expect(deriveCaType(undefined, undefined)).toBe('unknown');
  });
});

describe('deriveHealth', () => {
  it('reports error when unreachable regardless of other inputs', () => {
    expect(
      deriveHealth({ reachable: false, caType: 'prod', daysUntilExpiry: 90, minDays: 21 }),
    ).toBe('error');
  });
  it('reports staging for an untrusted staging CA even when far from expiry', () => {
    expect(
      deriveHealth({ reachable: true, caType: 'staging', daysUntilExpiry: 80, minDays: 21 }),
    ).toBe('staging');
  });
  it('reports expiringSoon when within the threshold', () => {
    expect(
      deriveHealth({ reachable: true, caType: 'prod', daysUntilExpiry: 10, minDays: 21 }),
    ).toBe('expiringSoon');
  });
  it('treats an already-expired cert (negative days) as expiringSoon', () => {
    expect(
      deriveHealth({ reachable: true, caType: 'prod', daysUntilExpiry: -3, minDays: 21 }),
    ).toBe('expiringSoon');
  });
  it('reports ok for a trusted, comfortably-in-date cert', () => {
    expect(
      deriveHealth({ reachable: true, caType: 'prod', daysUntilExpiry: 60, minDays: 21 }),
    ).toBe('ok');
  });
});

// `fetchPeerCertificate` is protected, so it has to be reached through a cast to
// spy on it. Naming the shape rather than casting the whole service to `never`:
// Vitest 4 resolves a spy on a `never`-typed object to `never` too, so
// `.mockImplementation` stops existing on it.
type TlsProbeSurface = { fetchPeerCertificate: (host: string) => Promise<PeerCertLike> };

describe('AdminTlsStatusService.probeAll', () => {
  let service: AdminTlsStatusService;

  beforeEach(() => {
    service = new AdminTlsStatusService(makeConfig({ DOMAIN: 'myclash.fr' }));
  });

  it('probes every deployed subdomain and classifies each certificate', async () => {
    vi.spyOn(service as unknown as TlsProbeSurface, 'fetchPeerCertificate').mockImplementation(
      async (host: string) => {
        if (host === 'api.myclash.fr') return certExpiringIn(90, "(STAGING) Let's Encrypt");
        if (host === 'app.myclash.fr') return certExpiringIn(10);
        if (host === 'admin.myclash.fr') throw new Error('ECONNREFUSED');
        return certExpiringIn(90);
      },
    );

    const result = await service.probeAll();

    expect(result.minDays).toBe(21);
    expect(result.certificates.map((c) => c.host)).toEqual([
      'myclash.fr',
      'www.myclash.fr',
      'api.myclash.fr',
      'app.myclash.fr',
      'admin.myclash.fr',
      'staff.myclash.fr',
      'traefik.myclash.fr',
    ]);

    const byHost = Object.fromEntries(result.certificates.map((c) => [c.host, c]));
    expect(byHost['api.myclash.fr']!.health).toBe('staging');
    expect(byHost['api.myclash.fr']!.caType).toBe('staging');
    expect(byHost['app.myclash.fr']!.health).toBe('expiringSoon');
    expect(byHost['app.myclash.fr']!.daysUntilExpiry).toBeLessThan(21);
    expect(byHost['admin.myclash.fr']!.health).toBe('error');
    expect(byHost['admin.myclash.fr']!.reachable).toBe(false);
    expect(byHost['admin.myclash.fr']!.error).toContain('ECONNREFUSED');
    expect(byHost['myclash.fr']!.health).toBe('ok');
  });

  it('honours a custom TLS_CERT_MIN_DAYS threshold', async () => {
    const svc = new AdminTlsStatusService(
      makeConfig({ DOMAIN: 'myclash.fr', TLS_CERT_MIN_DAYS: '45' }),
    );
    vi.spyOn(svc as unknown as TlsProbeSurface, 'fetchPeerCertificate').mockImplementation(
      async () => certExpiringIn(30),
    );

    const result = await svc.probeAll();

    expect(result.minDays).toBe(45);
    // 30 days left is now below the 45-day threshold → expiringSoon.
    expect(result.certificates.every((c) => c.health === 'expiringSoon')).toBe(true);
  });
});
