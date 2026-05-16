import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { MeResponseDto } from './dto/me-response.dto';
import { PersonalSpaceResponseDto } from './dto/personal-space-response.dto';

@ApiTags('auth')
@Controller()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  /**
   * GET /api/v1/me
   *
   * Returns the current identity:
   *   - claimed: Supabase JWT present and valid
   *   - guest:   mc_guest cookie present and valid (no Supabase JWT)
   *   - anonymous: neither
   *
   * When both claimed + guest are present, claimed wins and the guest
   * cookie is cleared (consolidation).
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current identity (claimed / guest / anonymous)' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getMe(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const result = await this.auth.getMe(req, reply);
    void reply.status(200).send(result);
  }

  @Get('me/personal-space')
  @ApiOperation({ summary: 'Get current claimed user personal-space data' })
  @ApiResponse({ status: 200, type: PersonalSpaceResponseDto })
  async getPersonalSpace(@Req() req: FastifyRequest): Promise<PersonalSpaceResponseDto> {
    return this.auth.getPersonalSpace(req);
  }
}
