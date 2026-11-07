import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformPhotoEvent } from '@myclash/types';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { PlatformRole } from '../admin/guards/platform-role.decorator';
import { PhotoPlatformService } from './photo-platform.service';

/**
 * The platform's Photos page (ruling 493). A platform super admin only: `super_admin` is the one
 * tier that narrows a GET under `PlatformRoleGuard`. The Event's queue itself is served by the
 * club's own routes, whose gate admits a super admin (`moderatorsEvent`, ruling 491).
 */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@PlatformRole('super_admin')
@Controller('admin/photos')
export class PhotoPlatformController {
  constructor(private readonly platform: PhotoPlatformService) {}

  @Get('events')
  @ApiOperation({
    summary: 'The Events that take or still hold photos, newest first (super admin)',
  })
  events(): Promise<PlatformPhotoEvent[]> {
    return this.platform.events();
  }
}
