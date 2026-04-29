import { Module } from '@nestjs/common';
import { LicesController } from './lices.controller';
import { LicesService } from './lices.service';

@Module({
  controllers: [LicesController],
  providers: [LicesService],
  exports: [LicesService],
})
export class LicesModule {}
