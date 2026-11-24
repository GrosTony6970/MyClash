import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { ConnectedApps } from '@myclash/types';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { ConnectedAppsService } from './connected-apps.service';
import { signedInLogin } from './gotrue-as-person';

/**
 * The security page's list of connected apps. A `me` route: the signed-in person's own apps.
 * AuthGuard refuses a connector token on every route but the MCP door, so the login here is
 * always the person's browser login — an app cannot disconnect itself or another app.
 */
@ApiTags('mcp')
@Controller('me/connected-apps')
export class ConnectedAppsController {
  constructor(
    private readonly apps: ConnectedAppsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The apps the signed-in person has connected to their account' })
  @ApiResponse({ status: 200, description: '{ apps: { clientId, name, grantedAt }[] }' })
  @ApiResponse({ status: 401, description: 'Signed out, or the login ended' })
  @ApiResponse({ status: 503, description: 'The sign-in server gave no usable answer' })
  async list(@Req() req: FastifyRequest): Promise<ConnectedApps> {
    return this.apps.list(await signedInLogin(req, this.supabase));
  }

  @Delete(':clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect one app; it may keep access for up to an hour' })
  @ApiResponse({ status: 204, description: 'Disconnected, or it already was' })
  @ApiResponse({ status: 400, description: 'The client id is not a UUID' })
  @ApiResponse({ status: 401, description: 'Signed out, or the login ended' })
  @ApiResponse({ status: 503, description: 'The sign-in server gave no usable answer' })
  async disconnect(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.apps.disconnect(clientId, await signedInLogin(req, this.supabase));
  }
}
