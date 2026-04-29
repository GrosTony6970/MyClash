import { Module } from '@nestjs/common';
import { CsvImportService } from './csv-import.service';
import { LookupController } from './lookup.controller';
import { PersonsController } from './persons.controller';
import { PersonsService } from './persons.service';

@Module({
  controllers: [PersonsController, LookupController],
  providers: [PersonsService, CsvImportService],
  exports: [PersonsService, CsvImportService],
})
export class PersonsModule {}
