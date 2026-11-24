import { Module } from '@nestjs/common';
import { ProtectedResourceController } from './protected-resource.controller';

/** The MCP door: Claude's connector into MyClash. */
@Module({
  controllers: [ProtectedResourceController],
})
export class McpModule {}
