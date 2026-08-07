import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateBudgetDto } from '../ai-providers/dto/update-budget.dto';
import { ModelSyncDto } from './dto/model-sync.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformRole } from './guards/platform-role.decorator';
import { ModelSyncService } from './model-sync.service';
import { PlatformAISettingsService } from './platform-ai-settings.service';

/**
 * Platform-wide AI *config* (global monthly ceiling) + model-sync. The keys
 * themselves are managed by PlatformAIKeysController (`/admin/ai-keys`).
 */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@PlatformRole('super_admin')
@Controller('admin/ai-settings')
export class PlatformAISettingsController {
  constructor(
    private readonly settings: PlatformAISettingsService,
    private readonly modelSync: ModelSyncService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the platform AI config (global monthly ceiling)' })
  getSettings() {
    return this.settings.getConfig();
  }

  @Patch('budget')
  @ApiOperation({ summary: 'Set the platform monthly AI ceiling' })
  async setBudget(@Body() dto: UpdateBudgetDto) {
    await this.settings.updateBudget(dto.monthlyBudgetEur);
    return this.settings.getConfig();
  }

  @Post('model-sync')
  @ApiOperation({
    summary: "Diff the model registry against a provider's live models (ad-hoc / active key)",
  })
  runModelSync(@Body() dto: ModelSyncDto) {
    return this.modelSync.diff({
      providerOverride: dto.provider ?? null,
      apiKeyOverride: dto.apiKey ?? null,
    });
  }
}
