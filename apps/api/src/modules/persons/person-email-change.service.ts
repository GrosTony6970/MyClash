import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import type { FastifyRequest } from 'fastify';
import { AddressChangeUnjudged, changeAddress } from '../auth/auth-server-calls';
import { addressTakenOnHerRosters, moveClaimedRowsToAddress } from '../auth/claimed-person-sync';
import { MailService } from '../mail/mail.service';
import { insertAuditLog } from '../../common/audit-log';
import { captureApiException } from '../../common/observability/sentry';
import { SupabaseService } from '../supabase/supabase.service';
import type { RequestPersonEmailChangeDto } from './dto/person-email-change.dto';
import { emailChangePage, type EmailChangeOutcome } from './email-change-page';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_BYTES = 32;
const EXPIRES_MS = 60 * 60 * 1000;

interface ClaimedPersonRow {
  id: string;
  event_id: string;
  email: string;
}

interface EmailChangeRequestRow {
  id: string;
  user_id: string;
  old_email: string;
  new_email: string;
  expires_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

type RequestWithCookies = Pick<FastifyRequest, 'headers'> & {
  cookies?: Record<string, string | undefined>;
};

@Injectable()
export class PersonEmailChangeService {
  private readonly logger = new Logger(PersonEmailChangeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async requestEmailChange(
    req: RequestWithCookies,
    dto: RequestPersonEmailChangeDto,
  ): Promise<{ newEmail: string; expiresAt: string }> {
    const { userId, currentEmail } = await this.resolveClaimedUser(req);
    const newEmail = this.normalizeEmail(dto.newEmail);

    if (!EMAIL_RE.test(newEmail)) {
      throw new BadRequestException('Invalid email address');
    }
    if (newEmail === currentEmail.toLowerCase()) {
      throw new BadRequestException('New email must be different from the current email');
    }

    const claimedPersons = await this.listClaimedPersons(userId);
    if (claimedPersons.length === 0) {
      throw new UnauthorizedException('No claimed Person profile linked to this account');
    }

    if (await addressTakenOnHerRosters(this.supabase, userId, newEmail)) {
      throw new ConflictException('This email is already used by another person in this event');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRES_MS).toISOString();
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(token);

    const { error: cancelError } = await this.supabase.service
      .from('person_email_change_requests')
      .update({ cancelled_at: now.toISOString() })
      .eq('user_id', userId)
      .is('confirmed_at', null)
      .is('cancelled_at', null);

    if (cancelError) throw new BadRequestException(cancelError.message);

    const { error: insertError } = await this.supabase.service
      .from('person_email_change_requests')
      .insert({
        user_id: userId,
        old_email: currentEmail.toLowerCase(),
        new_email: newEmail,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insertError) throw new BadRequestException(insertError.message);

    await this.mail.sendEmailChangeConfirmation({
      to: newEmail,
      oldEmail: currentEmail.toLowerCase(),
      newEmail,
      confirmUrl: this.buildConfirmUrl(token),
      expiresAt,
    });

    return { newEmail, expiresAt };
  }

  async getPendingEmailChange(
    req: RequestWithCookies,
  ): Promise<{ newEmail: string; expiresAt: string } | null> {
    const { userId } = await this.resolveClaimedUser(req);
    const { data, error } = await this.supabase.service
      .from('person_email_change_requests')
      .select('new_email, expires_at')
      .eq('user_id', userId)
      .is('confirmed_at', null)
      .is('cancelled_at', null)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) return null;

    const row = data as { new_email: string; expires_at: string };
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return { newEmail: row.new_email, expiresAt: row.expires_at };
  }

  async cancelEmailChange(req: RequestWithCookies): Promise<void> {
    const { userId } = await this.resolveClaimedUser(req);
    const { error } = await this.supabase.service
      .from('person_email_change_requests')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('confirmed_at', null)
      .is('cancelled_at', null);

    if (error) throw new BadRequestException(error.message);
  }

  /**
   * The page the confirm link's door sends its reader to (operator ruling 371):
   * a browser that followed a link reads no body.
   */
  async pageAfterConfirm(token: string): Promise<string> {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    return emailChangePage(domain, await this.confirmEmailChange(token));
  }

  /**
   * Confirm the request a mailed link's token names, and say what became of it
   * (operator ruling 371). A fault after the auth server changed the address
   * still throws: the link is not known to work again by then.
   */
  async confirmEmailChange(token: string): Promise<EmailChangeOutcome> {
    const request = await this.liveRequest(token);
    if (typeof request === 'string') return request;

    const { user_id: userId, new_email: newEmail } = request;
    const changed = await changeAddress(this.supabase.service, userId, newEmail).catch(
      (fault: unknown) => {
        if (!(fault instanceof AddressChangeUnjudged)) throw fault;
        this.logger.warn(`The email change of user:${userId} was not judged: ${fault.message}`);
        return null;
      },
    );
    if (changed === null) return 'unchecked';
    if (!changed) return 'refused';

    const confirmedAt = new Date().toISOString();
    const { error: confirmError } = await this.supabase.service
      .from('person_email_change_requests')
      .update({ confirmed_at: confirmedAt })
      .eq('id', request.id);
    if (confirmError) throw new BadRequestException(confirmError.message);

    const personsError = await moveClaimedRowsToAddress(
      this.supabase,
      request.user_id,
      request.new_email,
    );
    if (personsError) throw new BadRequestException(personsError.message);

    await this.writeAuditLog(request);
    return 'changed';
  }

  /**
   * The request a link's token names, while it can still be confirmed. `dead`:
   * no such request, or one that is used, cancelled or past its hour.
   * `unchecked`: the read failed. Nothing is written by then, so the same link
   * works again; the door redirects and has no 5xx to report, so the fault is
   * reported here.
   */
  private async liveRequest(token: string): Promise<EmailChangeRequestRow | 'dead' | 'unchecked'> {
    if (!token) return 'dead';

    const { data, error } = await this.supabase.service
      .from('person_email_change_requests')
      .select('id, user_id, old_email, new_email, expires_at, confirmed_at, cancelled_at')
      .eq('token_hash', this.hashToken(token))
      .maybeSingle();
    if (error) {
      this.logger.error(`An email-change link could not be checked: ${error.message}`);
      captureApiException(new Error(error.message), { door: 'persons/me/email-change/confirm' });
      return 'unchecked';
    }

    const request = data as EmailChangeRequestRow | null;
    if (!request || request.cancelled_at || request.confirmed_at) return 'dead';
    return new Date(request.expires_at).getTime() <= Date.now() ? 'dead' : request;
  }

  private async resolveClaimedUser(
    req: RequestWithCookies,
  ): Promise<{ userId: string; currentEmail: string }> {
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Authentication required');

    const user = await this.supabase.getAuthUser(token);
    if (!user?.email) throw new UnauthorizedException('Invalid or expired session');

    return { userId: user.id, currentEmail: user.email };
  }

  private async listClaimedPersons(userId: string): Promise<ClaimedPersonRow[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, event_id, email')
      .eq('claimed_by_user_id', userId);

    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ClaimedPersonRow[];
  }

  private extractToken(req: RequestWithCookies): string | null {
    const authHeader = req.headers?.['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return req.cookies?.['sb-access-token'] ?? null;
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildConfirmUrl(token: string): string {
    const explicit = this.config.get<string>('API_PUBLIC_URL');
    const base = explicit?.trim() ? explicit.replace(/\/+$/, '') : this.defaultApiBase();
    return `${base}/api/v1/persons/me/email-change/confirm?token=${encodeURIComponent(token)}`;
  }

  private defaultApiBase(): string {
    const domain = this.config.get<string>('DOMAIN', 'myclash.localhost');
    return domain.includes('localhost') ? `https://api.${domain}` : `https://api.${domain}`;
  }

  /**
   * The addresses are passed RAW: insertAuditLog masks them to `j***@e***`.
   * This service used to mask by hand — that local helper is gone now the whole
   * codebase masks at write time, so there is exactly one place to change the
   * convention.
   */
  private async writeAuditLog(request: EmailChangeRequestRow): Promise<void> {
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId: request.user_id,
      action: 'person.email_change_confirmed',
      entityType: 'user',
      entityId: request.user_id,
      payload: { old_email: request.old_email, new_email: request.new_email },
    });
    if (error) {
      this.logger.warn(`Could not write audit log for email change on user:${request.user_id}`);
    }
  }
}
