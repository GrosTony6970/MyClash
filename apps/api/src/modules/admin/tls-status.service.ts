import tls from 'node:tls';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  TlsCaType,
  TlsCertHealth,
  TlsCertStatusDto,
  TlsStatusResponseDto,
} from './dto/tls-status.dto';

/** Minimal shape of Node's `getPeerCertificate()` result that we consume. */
export interface PeerCertLike {
  valid_from?: string;
  valid_to?: string;
  issuer?: { O?: string; CN?: string };
  subject?: { CN?: string };
}

const DEFAULT_MIN_DAYS = 21;
const PROBE_TIMEOUT_MS = 10_000;
const MS_PER_DAY = 86_400_000;

/**
 * Classify the issuing CA from the certificate issuer fields. Staging must win
 * over prod because the LE staging issuer literally contains "(STAGING) Let's
 * Encrypt" — surfacing the untrusted-staging state is the whole point.
 */
export function deriveCaType(issuerOrg?: string, issuerCn?: string): TlsCaType {
  const text = `${issuerOrg ?? ''} ${issuerCn ?? ''}`.toUpperCase();
  if (text.includes('STAGING')) return 'staging';
  if (text.includes("LET'S ENCRYPT") || text.includes('LETSENCRYPT')) return 'prod';
  return 'unknown';
}

/**
 * Renewal-health signal. Order matters: unreachable dominates, then the
 * untrusted-staging warning, then the expiry threshold. A trusted, in-date
 * cert is `ok`.
 */
export function deriveHealth(params: {
  reachable: boolean;
  caType: TlsCaType;
  daysUntilExpiry?: number;
  minDays: number;
}): TlsCertHealth {
  if (!params.reachable) return 'error';
  if (params.caType === 'staging') return 'staging';
  if (params.daysUntilExpiry != null && params.daysUntilExpiry < params.minDays) {
    return 'expiringSoon';
  }
  return 'ok';
}

/**
 * Probes the served TLS certificate for each deployed `${DOMAIN}` subdomain and
 * reports issuer / expiry / renewal-health. This is a live TLS handshake, not a
 * read of Traefik's `acme.json` (the API container has no access to it).
 *
 * The TCP target defaults to the in-network `traefik` service with the public
 * subdomain passed as SNI, so cert selection is correct without depending on
 * public DNS hairpinning back into the VPS. Override the target with
 * `TLS_PROBE_HOST` if the API runs outside the compose network.
 */
@Injectable()
export class AdminTlsStatusService {
  private readonly logger = new Logger(AdminTlsStatusService.name);

  constructor(private readonly config: ConfigService) {}

  private get minDays(): number {
    const raw = Number(this.config.get<string>('TLS_CERT_MIN_DAYS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_DAYS;
  }

  private get probeTarget(): string {
    return this.config.get<string>('TLS_PROBE_HOST', 'traefik');
  }

  /** Deployed subdomains, mirroring `scripts/check-edge-tls.mjs` + the dashboard host. */
  private hosts(): string[] {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    return [
      domain,
      `www.${domain}`,
      `api.${domain}`,
      `app.${domain}`,
      `admin.${domain}`,
      `scoring.${domain}`,
      `traefik.${domain}`,
    ];
  }

  async probeAll(): Promise<TlsStatusResponseDto> {
    const minDays = this.minDays;
    const results = await Promise.all(this.hosts().map((host) => this.probeHost(host, minDays)));
    return {
      checkedAt: new Date().toISOString(),
      minDays,
      certificates: results,
    };
  }

  private async probeHost(host: string, minDays: number): Promise<TlsCertStatusDto> {
    try {
      const cert = await this.fetchPeerCertificate(host);
      const issuerOrg = cert.issuer?.O;
      const issuerCn = cert.issuer?.CN;
      const caType = deriveCaType(issuerOrg, issuerCn);
      const validToMs = cert.valid_to ? Date.parse(cert.valid_to) : NaN;
      const daysUntilExpiry = Number.isFinite(validToMs)
        ? Math.floor((validToMs - Date.now()) / MS_PER_DAY)
        : undefined;
      return {
        host,
        reachable: true,
        issuerOrg,
        issuerCn,
        caType,
        validFrom: toIso(cert.valid_from),
        validTo: toIso(cert.valid_to),
        daysUntilExpiry,
        health: deriveHealth({ reachable: true, caType, daysUntilExpiry, minDays }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TLS handshake failed';
      this.logger.debug(`TLS probe failed for ${host}: ${message}`);
      return {
        host,
        reachable: false,
        caType: 'unknown',
        health: 'error',
        error: message,
      };
    }
  }

  /**
   * Network seam — opens a TLS connection to the probe target with the public
   * host as SNI and returns the served leaf certificate. `rejectUnauthorized`
   * is false ON PURPOSE: we must be able to *read* an untrusted (staging /
   * self-signed) cert's fields to classify it; trust is judged from the issuer,
   * not the handshake. Overridable in tests.
   */
  protected fetchPeerCertificate(host: string): Promise<PeerCertLike> {
    const target = this.probeTarget;
    return new Promise<PeerCertLike>((resolve, reject) => {
      const socket = tls.connect(
        {
          host: target,
          port: 443,
          servername: host,
          rejectUnauthorized: false,
          timeout: PROBE_TIMEOUT_MS,
        },
        () => {
          const cert = socket.getPeerCertificate() as PeerCertLike;
          socket.end();
          if (!cert || Object.keys(cert).length === 0) {
            reject(new Error('No certificate presented'));
            return;
          }
          resolve(cert);
        },
      );
      socket.on('error', reject);
      socket.on('timeout', () => {
        socket.destroy(new Error('timeout'));
      });
    });
  }
}

function toIso(value?: string): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
