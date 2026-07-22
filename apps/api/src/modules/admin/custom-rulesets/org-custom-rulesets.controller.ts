import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { OrganizationsService } from '../../organizations/organizations.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { CustomRulesetsService } from './custom-rulesets.service';
import {
  CreateCustomRulesetDto,
  UpdateCustomRulesetDto,
  ValidateRulesetDto,
} from './dto/custom-rulesets.dto';
import { resolveRequestUserId } from '../../../common/auth/request-user';

// Resolve the caller's user id from their Supabase JWT. Shared with the
// ruleset picker, which needs the identical behaviour — see the docblock on
// `resolveRequestUserId` for why `req.actorUserId` must NOT be used here.
const getUserId = resolveRequestUserId;

/**
 * Organizer-side scoring-ruleset CRUD. Lives under
 * `/api/v1/organizations/:orgId/custom-rulesets`. All routes require
 * org-admin (or super-admin) on the path's org.
 *
 * The list endpoint returns the catalog visible to that org: system
 * rulesets + the org's own + any other org's rows that a super-admin
 * approved for public sharing. The create/update/delete/submit endpoints
 * operate only on rows that belong to the path's org.
 *
 * Approve-public + reject-submission live on the super-admin controller
 * (`/api/v1/admin/custom-rulesets/:id/{approve-public,reject-submission}`).
 */
@ApiTags('organizer')
@ApiBearerAuth()
@Controller('organizations/:orgId/custom-rulesets')
export class OrgCustomRulesetsController {
  constructor(
    private readonly service: CustomRulesetsService,
    private readonly orgs: OrganizationsService,
    private readonly supabase: SupabaseService,
  ) {}

  private async assertOrgAdmin(orgId: string, userId: string): Promise<void> {
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
  }

  @Get()
  @ApiOperation({
    summary: 'List scoring rulesets visible to this org (own + system + public).',
  })
  async list(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    return this.service.listForOrg(orgId, userId);
  }

  @Get('catalog')
  @ApiOperation({
    summary:
      'Discover catalog: adoptable scoring rulesets (built-ins + other orgs’ approved-public), attributed by owning-org name.',
  })
  async catalog(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    return this.service.listCatalogForOrg(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one org-owned scoring ruleset (for the edit page).' })
  async getOne(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    return this.service.assertOrgOwns(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a scoring ruleset owned by this org.' })
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateCustomRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    return this.service.createForOrg(orgId, dto, userId);
  }

  @Post('validate')
  @ApiOperation({ summary: 'Validate + preview a scoring ruleset config without saving.' })
  async validate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ValidateRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    return this.service.validateAndPreview(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update an org-owned scoring ruleset's metadata or config." })
  async update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    await this.service.assertOrgOwns(id, orgId);
    return this.service.update(id, dto, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an org-owned scoring ruleset.' })
  async remove(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    await this.service.assertOrgOwns(id, orgId);
    await this.service.deleteForOrg(id, userId);
  }

  @Post(':id/submit')
  @ApiOperation({
    summary:
      'Submit this org-owned ruleset for super-admin review so it can be approved for platform-wide sharing.',
  })
  async submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.assertOrgAdmin(orgId, userId);
    await this.service.assertOrgOwns(id, orgId);
    return this.service.submitForReview(id, userId);
  }
}
