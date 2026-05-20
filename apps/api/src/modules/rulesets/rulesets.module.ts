import { Module } from '@nestjs/common';
import { RulesetsController } from './rulesets.controller';

@Module({
  controllers: [RulesetsController],
})
export class RulesetsModule {}
