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
import { MailService } from '../mail/mail.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { RequestPersonEmailChangeDto } from './dto/person-email-change.dto';

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

    for (const person of claimedPersons) {
      const { data: conflict, error } = await this.supabase.service
        .from('persons')
        .select('id')
        .eq('event_id', person.event_id)
        .ilike('email', newEmail)
        .neq('id', person.id)
        .maybeSingle();

      if (error) throw new BadRequestException(error.message);
      if (conflict) {
        throw new ConflictException('This email is already used by another person in this event');
      }
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

  async confirmEmailChange(token: string): Promise<{ email: string }> {
    if (!token) throw new BadRequestException('Missing confirmation token');

    const { data, error } = await this.supabase.service
      .from('person_email_change_requests')
      .select('id, user_id, old_email, new_email, expires_at, confirmed_at, cancelled_at')
      .eq('token_hash', this.hashToken(token))
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Invalid or expired email-change token');

    const request = data as EmailChangeRequestRow;
    if (request.cancelled_at || request.confirmed_at) {
      throw new BadRequestException('Email-change token has already been used');
    }
    if (new Date(request.expires_at).getTime() <= Date.now()) {
      throw new BadRequestException('Email-change token has expired');
    }

    const { error: authError } = await this.supabase.service.auth.admin.updateUserById(
      request.user_id,
      { email: request.new_email },
    );
    if (authError) throw new BadRequestException(authError.message);

    const confirmedAt = new Date().toISOString();
    const { error: confirmError } = await this.supabase.service
      .from('person_email_change_requests')
      .update({ confirmed_at: confirmedAt })
      .eq('id', request.id);
    if (confirmError) throw new BadRequestException(confirmError.message);

    const { error: personsError } = await this.supabase.service
      .from('persons')
      .update({ email: request.new_email, updated_at: confirmedAt })
      .eq('claimed_by_user_id', request.user_id);
    if (personsError) throw new BadRequestException(personsError.message);

    await this.writeAuditLog(request);
    return { email: request.new_email };
  }

  private async resolveClaimedUser(
    req: RequestWithCookies,
  ): Promise<{ userId: string; currentEmail: string }> {
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Authentication required');

    const { data, error } = await this.supabase.anon.auth.getUser(token);
    if (error || !data.user?.id || !data.user.email) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return { userId: data.user.id, currentEmail: data.user.email };
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

  private async writeAuditLog(request: EmailChangeRequestRow): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: request.user_id,
        action: 'person.email_change_confirmed',
        entity_type: 'user',
        entity_id: request.user_id,
        payload_json: {
          old_email: this.maskEmail(request.old_email),
          new_email: this.maskEmail(request.new_email),
        },
      });
    } catch {
      this.logger.warn(`Could not write audit log for email change on user:${request.user_id}`);
    }
  }

  private maskEmail(email: string | null | undefined): string {
    if (!email) return '';
    const [local = '', domain = ''] = email.split('@');
    const domainHead = domain.split('.')[0] ?? '';
    return `${local.slice(0, 1)}***@${domainHead.slice(0, 1)}***`;
  }
}
