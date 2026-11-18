import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AgentKeyGuard } from './agent-key.guard';
import { OpsAgentController } from './ops-agent.controller';

/**
 * The ops agent's door and its key (the ops agent's design). It reads through the admin services
 * and owns nothing the admin module depends on, so it imports `AdminModule` with no cycle.
 */
@Module({
  imports: [AdminModule],
  controllers: [OpsAgentController],
  providers: [AgentKeyGuard],
})
export class OpsAgentModule {}
