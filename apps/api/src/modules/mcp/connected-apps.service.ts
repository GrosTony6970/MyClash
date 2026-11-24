import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectedApp, ConnectedApps } from '@myclash/types';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { callGoTrueAsPerson } from './gotrue-as-person';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The apps a person has connected, read from and removed at GoTrue with the person's own login.
 *
 * Disconnecting also ends the app's refresh tokens, but an access token already issued lives
 * until it expires (an hour at most): the page says so. Any answer this file cannot read is a
 * 503 — never an empty list or a "disconnected" on a guess.
 */
@Injectable()
export class ConnectedAppsService {
  private readonly logger = new Logger(ConnectedAppsService.name);

  constructor(private readonly config: ConfigService) {}

  async list(login: string): Promise<ConnectedApps> {
    const response = await callGoTrueAsPerson(
      this.config,
      { path: '/user/oauth/grants', login, method: 'GET' },
      (why) => this.unavailable(why),
    );
    this.refuseLogin(response);
    if (!response.ok) throw this.unavailable(`status ${response.status}`);
    const body: unknown = await response.json().catch(() => null);
    if (!Array.isArray(body)) throw this.unavailable('an answer that is no array');
    return { apps: body.map((grant) => this.toApp(grant)) };
  }

  /** A client with no active grant is already disconnected: GoTrue's 404 reads as done. */
  async disconnect(clientId: string, login: string): Promise<void> {
    const response = await callGoTrueAsPerson(
      this.config,
      {
        path: `/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`,
        login,
        method: 'DELETE',
      },
      (why) => this.unavailable(why),
    );
    this.refuseLogin(response);
    if (response.status === 404) return;
    if (!response.ok) throw this.unavailable(`status ${response.status}`);
  }

  /** The page renews the login on a 401 and asks again. */
  private refuseLogin(response: Response): void {
    if (response.status === 401) throw new UnauthorizedException('Invalid or expired session');
  }

  private toApp(grant: unknown): ConnectedApp {
    const client = isRecord(grant) ? grant['client'] : null;
    if (
      !isRecord(grant) ||
      !isRecord(client) ||
      typeof client['id'] !== 'string' ||
      typeof client['name'] !== 'string' ||
      typeof grant['granted_at'] !== 'string'
    ) {
      throw this.unavailable('a grant has an unexpected shape');
    }
    return { clientId: client['id'], name: client['name'], grantedAt: grant['granted_at'] };
  }

  private unavailable(why: string): OperationalUnavailableException {
    this.logger.warn(`GoTrue gave the connected apps no usable answer: ${why}`);
    return new OperationalUnavailableException({
      code: 'connected_apps_unavailable',
      message: 'The sign-in server did not answer. Try again in a moment.',
    });
  }
}
