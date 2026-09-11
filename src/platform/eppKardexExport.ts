import JSZip from 'jszip';
import type { FilaMovimientoExcel } from '../reporteMovimientosExcel';

export const EPP_KARDEX_TEMPLATE_URL = '/templates/KARDEX-EPP.xlsx';
const OUTPUT_SHEET = 'xl/worksheets/sheet2.xml';
const INPUT_SHEET = 'xl/worksheets/sheet3.xml';
const SUMMARY_SHEET = 'xl/worksheets/sheet1.xml';
const EXCEL_EPOCH_OFFSET = 25569;
const ROW_LIMIT = 1_048_576;

type KardexRow = {
  date: Date;
  dateSerial: number;
  code: string;
  item: string;
  unit: string;
  quantity: number;
  responsible: string;
};

const escapeXml = (value: string) => value
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function excelDate(date: Date) {
  return Math.floor(date.getTime() / 86_400_000) + EXCEL_EPOCH_OFFSET;
}

function parseOperationalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function parseSheetRows(xml: string) {
  return xml.match(/<(?:x:)?row\b[^>]*\br="\d+"[^>]*>[\s\S]*?<\/(?:x:)?row>/g) ?? [];
}

function rowNumber(row: string) {
  const value = /\br="(\d+)"/.exec(row)?.[1];
  if (!value) throw new Error('La plantilla KARDEX EPP contiene una fila sin número.');
  return Number(value);
}

function moveRow(row: string, target: number) {
  return row.replace(/(<(?:x:)?row\b[^>]*\br=")\d+"/, `$1${target}"`)
    .replace(/\br="([A-Z]+)\d+"/g, (_all, column: string) => `r="${column}${target}"`);
}

function cellPattern(address: string) {
  return new RegExp(`<(?:x:)?c\\b([^>]*\\br="${address}"[^>]*)(?:\\/>|>[\\s\\S]*?<\\/(?:x:)?c>)`);
}

function setCell(row: string, column: string, index: number, value: string | number) {
  const address = `${column}${index}`;
  const pattern = cellPattern(address);
  const match = pattern.exec(row);
  if (!match) throw new Error(`La plantilla KARDEX EPP no contiene la celda ${address}.`);
  let attributes = match[1].replace(/\s+t="[^"]*"/g, '').replace(/\/$/, '');
  if (typeof value === 'number') return row.replace(pattern, () => `<x:c${attributes}><x:v>${value}</x:v></x:c>`);
  if (value.length > 32767) throw new Error(`El texto de ${address} excede el límite de Excel.`);
  attributes += ' t="inlineStr"';
  return row.replace(pattern, () => `<x:c${attributes}><x:is><x:t xml:space="preserve">${escapeXml(value)}</x:t></x:is></x:c>`);
}

function replaceOrAppendRow(sheet: string, row: string, index: number) {
  const current = new RegExp(`<(?:x:)?row\\b[^>]*\\br="${index}"[^>]*>[\\s\\S]*?<\\/(?:x:)?row>`);
  if (current.test(sheet)) return sheet.replace(current, row);
  const close = /<\/(?:x:)?sheetData>/;
  if (!close.test(sheet)) throw new Error('La plantilla KARDEX EPP no contiene datos de hoja.');
  return sheet.replace(close, `${row}$&`);
}

function lastRecordedRow(sheet: string) {
  const rows = parseSheetRows(sheet);
  const dated = rows.map((row) => {
    const number = /<\/?(?:x:)?c\b[^>]*\br="A\d+"[^>]*>[\s\S]*?<\/?(?:x:)?v>(\d+(?:\.\d+)?)<\/?(?:x:)?v>/.exec(row)?.[1];
    return number ? { row, dateSerial: Number(number) } : null;
  }).filter((value): value is { row: string; dateSerial: number } => Boolean(value));
  if (!dated.length) throw new Error('La plantilla KARDEX EPP no tiene movimientos fechados.');
  return {
    baselineDateSerial: Math.max(...dated.map((item) => item.dateSerial)),
    row: dated.reduce((last, current) => rowNumber(current.row) > rowNumber(last.row) ? current : last).row,
  };
}

function movementRows(rows: readonly FilaMovimientoExcel[], kind: 'entry' | 'exit', afterSerial: number): KardexRow[] {
  const quantityField = kind === 'entry' ? 'cantidad_entrada' : 'cantidad_salida';
  const invalid = rows.filter((row) => row[quantityField] > 0 && !parseOperationalDate(row.fecha));
  if (invalid.length) throw new Error(`Hay ${invalid.length} movimiento(s) EPP sin fecha válida. Corrígelos antes de exportar el Kardex.`);
  return rows.flatMap((row) => {
    const date = parseOperationalDate(row.fecha);
    const quantity = row[quantityField];
    if (!date || !Number.isFinite(quantity) || quantity <= 0 || excelDate(date) <= afterSerial) return [];
    if (!row.codigo.trim() || !row.nombre_producto.trim()) {
      throw new Error(`Hay un movimiento EPP posterior al Kardex sin código o descripción. Corrígelo antes de exportar.`);
    }
    return [{
      date, dateSerial: excelDate(date), code: row.codigo.trim(), item: row.nombre_producto.trim(),
      unit: row.unidad.trim() || 'Unidad', quantity, responsible: row.responsable.trim(),
    }];
  }).sort((a, b) => a.dateSerial - b.dateSerial || a.code.localeCompare(b.code) || a.item.localeCompare(b.item));
}

function updateFormulaRanges(summary: string, outputLastRow: number, inputLastRow: number) {
  return summary
    .replace(/('R\.S'!\$B\$2:\$B\$)947/g, `$1${Math.max(947, outputLastRow)}`)
    .replace(/('R\.S'!\$F\$2:\$F\$)947/g, `$1${Math.max(947, outputLastRow)}`)
    .replace(/('R\.E'!\$E\$2:\$E\$)894/g, `$1${Math.max(894, inputLastRow)}`)
    .replace(/('R\.E'!\$B\$2:\$B\$)894/g, `$1${Math.max(894, inputLastRow)}`);
}

function markForRecalculation(workbookXml: string) {
  if (/<(?:x:)?calcPr\b/.test(workbookXml)) {
    return workbookXml.replace(/<(x:)?calcPr\b([^>]*?)(?:\/>|>[\s\S]*?<\/(?:x:)?calcPr>)/,
      (_all, prefix = '', attributes: string) => `<${prefix}calcPr${attributes.replace(/\s+(?:fullCalcOnLoad|forceFullCalc)="[^"]*"/g, '')} fullCalcOnLoad="1" forceFullCalc="1"/>`);
  }
  return workbookXml.replace(/<\/(?:x:)?workbook>/, '<x:calcPr fullCalcOnLoad="1" forceFullCalc="1"/></x:workbook>');
}

export async function fillEppKardexTemplate(
  template: Uint8Array,
  entradas: readonly FilaMovimientoExcel[],
  salidas: readonly FilaMovimientoExcel[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const read = async (path: string) => {
    const part = zip.file(path);
    if (!part) throw new Error('No se pudo leer la plantilla original de Kardex EPP.');
    return part.async('string');
  };
  let outputSheet = await read(OUTPUT_SHEET);
  let inputSheet = await read(INPUT_SHEET);
  let summarySheet = await read(SUMMARY_SHEET);
  let workbook = await read('xl/workbook.xml');
  if (!workbook.includes('name="EPP"') || !workbook.includes('name="R.S"') || !workbook.includes('name="R.E"')) {
    throw new Error('El archivo descargado no es la plantilla de Kardex EPP esperada.');
  }

  const lastExit = lastRecordedRow(outputSheet);
  const lastEntry = lastRecordedRow(inputSheet);
  const baseline = Math.max(lastExit.baselineDateSerial, lastEntry.baselineDateSerial);
  const nextEntries = movementRows(entradas, 'entry', baseline);
  const nextExits = movementRows(salidas, 'exit', baseline);
  if (!nextEntries.length && !nextExits.length) {
    throw new Error('No hay movimientos EPP posteriores a la última fecha del Kardex para los filtros activos.');
  }
  if (rowNumber(lastExit.row) + nextExits.length > ROW_LIMIT || rowNumber(lastEntry.row) + nextEntries.length > ROW_LIMIT) {
    throw new Error('El Kardex supera el límite de filas de Excel.');
  }

  nextExits.forEach((item, offset) => {
    const index = rowNumber(lastExit.row) + offset + 1;
    let row = moveRow(lastExit.row, index);
    row = setCell(row, 'A', index, item.dateSerial);
    row = setCell(row, 'B', index, item.code);
    row = setCell(row, 'C', index, item.item);
    row = setCell(row, 'D', index, item.unit);
    row = setCell(row, 'E', index, item.responsible || 'Sin responsable');
    row = setCell(row, 'F', index, item.quantity);
    outputSheet = replaceOrAppendRow(outputSheet, row, index);
  });
  nextEntries.forEach((item, offset) => {
    const index = rowNumber(lastEntry.row) + offset + 1;
    let row = moveRow(lastEntry.row, index);
    row = setCell(row, 'A', index, item.dateSerial);
    row = setCell(row, 'B', index, item.code);
    row = setCell(row, 'C', index, item.item);
    row = setCell(row, 'D', index, item.unit);
    row = setCell(row, 'E', index, item.quantity);
    inputSheet = replaceOrAppendRow(inputSheet, row, index);
  });

  summarySheet = updateFormulaRanges(
    summarySheet,
    rowNumber(lastExit.row) + nextExits.length,
    rowNumber(lastEntry.row) + nextEntries.length,
  );
  workbook = markForRecalculation(workbook);
  zip.file(OUTPUT_SHEET, outputSheet);
  zip.file(INPUT_SHEET, inputSheet);
  zip.file(SUMMARY_SHEET, summarySheet);
  zip.file('xl/workbook.xml', workbook);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function exportEppKardexTemplate(
  entradas: readonly FilaMovimientoExcel[],
  salidas: readonly FilaMovimientoExcel[],
): Promise<Uint8Array> {
  const response = await fetch(EPP_KARDEX_TEMPLATE_URL);
  if (!response.ok) throw new Error('No se pudo descargar el formato de Kardex EPP. Comprueba la conexión e inténtalo nuevamente.');
  return fillEppKardexTemplate(new Uint8Array(await response.arrayBuffer()), entradas, salidas);
}
