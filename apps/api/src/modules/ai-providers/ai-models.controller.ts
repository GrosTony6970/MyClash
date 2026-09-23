import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { getAllModelOptions } from './model-registry';

/**
 * Read-only catalog of selectable AI models per provider, used by the
 * org + platform AI-settings model pickers. Returns labels + capability flags
 * only (no pricing).
 */
@ApiTags('ai-providers')
@Controller('ai')
export class AIModelsController {
  /** GET /api/v1/ai/models */
  @Public()
  @Get('models')
  @ApiOperation({ summary: 'List selectable AI models per provider (public)' })
  getModels() {
    return getAllModelOptions();
  }
}
