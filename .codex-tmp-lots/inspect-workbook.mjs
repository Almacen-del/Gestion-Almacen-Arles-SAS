import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'C:/Users/Almacen/Desktop/lotes_y_fechas_vencimiento.xlsx';
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 12000,
  tableMaxRows: 100,
  tableMaxCols: 12,
  tableMaxCellChars: 120,
});
console.log(summary.ndjson);
