import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CSV_FORMAT_PARAMS,
  csvFile,
  csvFormatFromParam,
  type CsvFormatParam,
} from '@myclash/types';

/**
 * Which file a CSV download of the server asks for (operator, 2026-10-15): `?csv=excel-fr` is
 * French Excel's (`;`, `12,50`), `?csv=standard` the others' (`,`, `12.50`). A link made before the
 * choice names none, and keeps the standard file. Any other value is a 400.
 */
const csvDownloadQuerySchema = z
  .object({
    csv: z.enum(CSV_FORMAT_PARAMS).default('standard'),
  })
  .strict();
export class CsvDownloadQueryDto extends createZodDto(csvDownloadQuerySchema) {}

/** The text of the file `query` asks for: `csvFile`, the one owner of a downloaded CSV's shape. */
export function csvDownload(
  rows: ReadonlyArray<readonly unknown[]>,
  query: { csv: CsvFormatParam },
) {
  return csvFile(rows, csvFormatFromParam(query.csv));
}
