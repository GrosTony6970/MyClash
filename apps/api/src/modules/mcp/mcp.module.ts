import { Module } from '@nestjs/common';
import { MeModule } from '../me/me.module';
import { McpController } from './mcp.controller';
import { McpDoorGuard } from './mcp-door.guard';
import { ProtectedResourceController } from './protected-resource.controller';

/** The MCP door: Claude's connector into MyClash. */
@Module({
  imports: [MeModule],
  controllers: [ProtectedResourceController, McpController],
  providers: [McpDoorGuard],
})
export class McpModule {}
