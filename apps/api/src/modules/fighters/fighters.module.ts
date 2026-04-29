import { Module } from '@nestjs/common';
import { FightersController } from './fighters.controller';
import { FightersService } from './fighters.service';

@Module({
  controllers: [FightersController],
  providers: [FightersService],
  exports: [FightersService],
})
export class FightersModule {}
