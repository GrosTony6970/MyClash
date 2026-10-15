/**
 * Hand a CSV text to the browser as a download named `filename`. The text is `csvFile` of
 * `@myclash/types`, in the format picked at the download (`CsvExportMenu`).
 */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
