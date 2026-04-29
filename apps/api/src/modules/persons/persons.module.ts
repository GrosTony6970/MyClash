import { Module } from '@nestjs/common';
import { CsvImportService } from './csv-import.service';
import { PersonsController } from './persons.controller';
import { PersonsService } from './persons.service';

@Module({
  controllers: [PersonsController],
  providers: [PersonsService, CsvImportService],
  exports: [PersonsService, CsvImportService],
})
export class PersonsModule {}
