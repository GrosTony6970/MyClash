/**
 * TLS certificate status DTOs for the System Versions admin page.
 *
 * The API self-probes each deployed `${DOMAIN}` subdomain over TLS and reports
 * the served leaf certificate's issuer, validity window, and a derived health
 * signal. Nothing here reads Traefik's `acme.json` — it's a live handshake
 * against the served endpoint (see AdminTlsStatusService).
 */

/** How the served leaf certificate was issued. */
export type TlsCaType = 'prod' | 'staging' | 'unknown';

/**
 * Renewal-health signal, most-actionable first:
 *   - `error`        — the endpoint was unreachable / the handshake failed.
 *   - `staging`      — issued by the Let's Encrypt *staging* CA (untrusted by
 *                      browsers); the deploy needs to switch off `--dev-certs`.
 *   - `expiringSoon` — fewer than `minDays` days until expiry.
 *   - `ok`           — trusted and comfortably in date.
 */
export type TlsCertHealth = 'ok' | 'expiringSoon' | 'staging' | 'error';

export interface TlsCertStatusDto {
  host: string;
  reachable: boolean;
  issuerOrg?: string;
  issuerCn?: string;
  caType: TlsCaType;
  /** ISO timestamp; omitted when the handshake failed. */
  validFrom?: string;
  /** ISO timestamp; omitted when the handshake failed. */
  validTo?: string;
  /** Whole days until `validTo`; negative once expired. Omitted on failure. */
  daysUntilExpiry?: number;
  health: TlsCertHealth;
  /** Present only when `reachable` is false — the connection/handshake error. */
  error?: string;
}

export interface TlsStatusResponseDto {
  checkedAt: string;
  /** Expiry threshold (days) below which a cert is flagged `expiringSoon`. */
  minDays: number;
  certificates: TlsCertStatusDto[];
}
