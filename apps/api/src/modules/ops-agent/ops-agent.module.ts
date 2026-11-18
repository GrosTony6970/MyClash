import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminAgentKeysController } from './admin-agent-keys.controller';
import { AgentKeyGuard } from './agent-key.guard';
import { AgentKeysService } from './agent-keys.service';
import { OpsAgentController } from './ops-agent.controller';

/**
 * The ops agent's door and its key (the ops agent's design). It reads through the admin services
 * and owns nothing the admin module depends on, so it imports `AdminModule` with no cycle.
 */
@Module({
  imports: [AdminModule],
  controllers: [OpsAgentController, AdminAgentKeysController],
  providers: [AgentKeyGuard, AgentKeysService],
})
export class OpsAgentModule {}
