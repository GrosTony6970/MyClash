/**
 * subject-export.controller.ts
 *
 * GET /api/v1/me/data-export.zip — the subject's own data (GDPR Art. 15 / 20).
 *
 * Lives in the privacy module rather than on auth's `/me` controller: both
 * already serve `/me` routes, and keeping this one separate avoids an
 * AuthModule ↔ PrivacyModule import cycle, which only fails at real boot.
 */

import { Controller, Get, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { SubjectExportService } from './subject-export.service';

/**
 * Resolves the caller, or throws.
 *
 * Deliberately NOT the `?? 'anonymous'` shape used by exports.controller: a
 * sentinel there yields an empty organiser export, but here it would hand a
 * data-subject bundle to an unauthenticated caller. No token means 401.
 */
async function resolveUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Invalid or expired session');
  return user.id;
}

@ApiTags('privacy')
@ApiBearerAuth()
@Controller()
export class SubjectExportController {
  constructor(
    private readonly subjectExport: SubjectExportService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('me/data-export.zip')
  @ApiOperation({ summary: 'Download everything MyClash holds about the current user' })
  async download(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const userId = await resolveUserId(req, this.supabase);
    const { filename, buffer } = await this.subjectExport.buildBundle(userId);
    void reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      // A personal data bundle must never sit in a shared or browser cache.
      .header('Cache-Control', 'no-store, private')
      .send(buffer);
  }
}
