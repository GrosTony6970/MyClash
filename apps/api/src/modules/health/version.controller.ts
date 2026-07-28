import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { VersionResponseDto } from './dto/version-response.dto';
import { VersionService } from './version.service';

@ApiTags('ops')
@Public()
@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  /**
   * GET /api/v1/version
   *
   * Answers "what is actually running right now?" without an SSH session.
   *
   * ── Why this is under the api/v1 prefix, unlike /health ────────────────────
   * Traefik routes `Host(api.${DOMAIN})` wholesale to this container, but
   * `app.`, `admin.` and `scoring.` route ONLY `PathPrefix(/api/v1)`. An
   * unprefixed /version would answer on api.myclash.fr and 404 on the
   * same-origin app.myclash.fr/api/* path that is used in practice — and it
   * would look correct in a local `curl localhost:4000/version`. main.ts used
   * to carry a `version` entry in the global-prefix `exclude` list for a
   * controller that was never written; it was removed when this shipped.
   *
   * /health stays unprefixed because the Docker healthcheck and the deploy
   * smoke tests hit `localhost:4000/health` directly.
   *
   * @Public() is deliberate: an uptime monitor and a post-deploy check both
   * need this without a session. The payload is a narrow, hand-picked
   * projection — the full manifest (deployedBy, backup filenames, infra image
   * versions) stays behind SuperAdminGuard on /admin/system-versions.
   *
   * No @SkipThrottle here, unlike /health: nothing in the infrastructure
   * depends on this endpoint answering, so it keeps the global rate limit.
   */
  @Get()
  @ApiOperation({ summary: 'Deployed version, commit and deploy time' })
  @ApiResponse({
    status: 200,
    description: 'Version metadata for the running instance',
    type: VersionResponseDto,
  })
  getVersion(): Promise<VersionResponseDto> {
    return this.versionService.getVersion();
  }
}
