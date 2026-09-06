import JSZip from 'jszip';
import type { FuelDeliveryRow } from '../fuelDeliveryReport';

export const FUEL_TEMPLATE_URL = '/templates/GA-F-006-combustible-v002.xlsx';
const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const escapeXml = (value: string) => value
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

type CellValue = string | number | { formula: string; result: number };
const quantityFormat = (value: number) => Number.isInteger(value) ? '0' : '0.###############';

function setCell(row: string, column: string, index: number, value: CellValue, style?: number) {
  const address = `${column}${index}`;
  const pattern = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)(?:/>|>[\\s\\S]*?</c>)`);
  const match = pattern.exec(row);
  if (!match) throw new Error(`La plantilla GA-F-006 no contiene la celda ${address}.`);
  let attributes = match[1].replace(/\s+t="[^"]*"/g, '').replace(/\/$/, '');
  if (style !== undefined) attributes = attributes.replace(/\s+s="[^"]*"/, '') + ` s="${style}"`;
  let content: string;
  if (typeof value === 'number') content = `<v>${value}</v>`;
  else if (typeof value === 'object') content = `<f>${escapeXml(value.formula)}</f><v>${value.result}</v>`;
  else {
    if (value.length > 32767) throw new Error(`El texto de ${address} excede el límite de Excel.`);
    attributes += ' t="inlineStr"';
    content = `<is><t xml:space="preserve">${escapeXml(value)}</t></is>`;
  }
  return row.replace(pattern, () => `<c${attributes}>${content}</c>`);
}

function rowAt(xml: string, index: number) {
  const row = new RegExp(`<row\\b[^>]*\\br="${index}"[^>]*>[\\s\\S]*?</row>`).exec(xml)?.[0];
  if (!row) throw new Error(`La plantilla GA-F-006 no contiene la fila ${index}.`);
  return row;
}

function moveRow(row: string, to: number) {
  return row.replace(/(<row\b[^>]*\br=")\d+"/, `$1${to}"`)
    .replace(/\br="([A-Z]+)\d+"/g, (_all, column: string) => `r="${column}${to}"`);
}

// Keep all native OOXML parts (logo, drawing relationships, printer settings,
// change log, existing styles). A workbook round-trip would drop unsupported parts.
// Only cells, repeated body rows and their dependent print/footer ranges change.
export async function fillFuelTemplate(template: Uint8Array, rows: readonly FuelDeliveryRow[]): Promise<Uint8Array> {
  if (!rows.length) throw new Error('No hay entradas o salidas de ACPM y gasolina para los filtros seleccionados.');
  const count = Math.max(20, rows.length);
  const offset = count - 20;
  if (1000 + offset > 1048576) throw new Error('El reporte supera el límite de filas de Excel. Selecciona un período menor.');
  const zip = await JSZip.loadAsync(template);
  const read = async (path: string) => {
    const part = zip.file(path);
    if (!part) throw new Error('No se pudo leer la plantilla original GA-F-006.');
    return part.async('string');
  };
  let sheet = await read(SHEET_PATH);
  let styles = await read('xl/styles.xml');
  let workbook = await read('xl/workbook.xml');
  if (!workbook.includes('name="COMBUSTIBLE"') || !workbook.includes('name="CONTROL DE CAMBIOS"')) {
    throw new Error('El archivo descargado no es la plantilla de combustible esperada.');
  }

  const xfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  if (!xfsMatch) throw new Error('La plantilla no contiene estilos de celda.');
  const xfs = xfsMatch[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  const formats = new Map<string, number>();
  const newFormats: string[] = [];
  const newStyles: string[] = [];
  const styleCache = new Map<string, number>();
  let nextFormat = Math.max(163, ...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(match => Number(match[1]))) + 1;
  const formattedStyle = (row: string, column: string, index: number, format?: string, wrap = false) => {
    const cell = new RegExp(`<c\\b[^>]*\\br="${column}${index}"[^>]*>`).exec(row)?.[0];
    const original = Number(/\bs="(\d+)"/.exec(cell || '')?.[1] || 0);
    const key = `${original}:${format || ''}:${wrap}`;
    if (styleCache.has(key)) return styleCache.get(key)!;
    if (format && !formats.has(format)) {
      formats.set(format, nextFormat++);
      newFormats.push(`<numFmt numFmtId="${formats.get(format)}" formatCode="${escapeXml(format)}"/>`);
    }
    let xf = xfs[original];
    if (!xf) throw new Error('Estilo de la plantilla no reconocido.');
    if (format) xf = xf.replace(/\s+numFmtId="\d+"/, '').replace(/\s+applyNumberFormat="[^"]*"/, '')
      .replace('<xf', `<xf numFmtId="${formats.get(format)}" applyNumberFormat="1"`);
    if (wrap) xf = xf.replace(/<alignment\b([^>]*?)\/>/, (_all, attrs: string) =>
      `<alignment${attrs.replace(/\s+wrapText="[^"]*"/, '')} wrapText="1"/>`);
    const id = xfs.length + newStyles.length;
    newStyles.push(xf);
    styleCache.set(key, id);
    return id;
  };

  const body: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = i + 5;
    const originalIndex = i === 0 ? 5 : i === count - 1 && i % 2 === 1 ? 24 : i % 2 === 1 ? 6 : 7;
    let row = moveRow(rowAt(sheet, originalIndex), index);
    row = setCell(row, 'A', index, i + 1);
    const data = rows[i];
    if (data) {
      const values: CellValue[] = [data.dateSerial, data.fuel === 'ACPM' ? 'X' : '', data.fuel === 'Gasolina' ? 'X' : '',
        data.gallons, data.hourMeter, data.machinery, data.plate, data.labor, data.destination,
        data.receiver, data.deliverer, data.company, data.observations];
      for (let j = 0; j < values.length; j++) {
        const column = String.fromCharCode(66 + j);
        const style = column === 'B' ? formattedStyle(row, column, index, 'dd/mm/yyyy')
          : column === 'E' ? formattedStyle(row, column, index, quantityFormat(data.gallons))
          : formattedStyle(row, column, index, undefined, true);
        row = setCell(row, column, index, values[j], style);
      }
      // Preserve column widths/typeface; only grow a row when recorded text needs it.
      const widths = [13, 8.57, 9.43, 12.29, 19.14, 19, 11.43, 24.71, 10, 28, 26.29, 14.71, 33];
      const lines = Math.max(2, ...values.map((value, j) => typeof value === 'string'
        ? value.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widths[j] - 2))), 0) : 1));
      row = row.replace(/\bht="[^"]*"/, `ht="${Math.min(409, Math.max(30, lines * 15))}"`);
    }
    if (i === count - 1 && i % 2 === 0) {
      // Odd-length tables end on a white row but retain the template's closing border.
      const lastTemplateRow = rowAt(sheet, 24);
      row = row.replace(/<c\b([^>]*\br="([A-N])\d+"[^>]*)>/g, (all, attrs: string, column: string) => {
        const currentId = Number(/\bs="(\d+)"/.exec(attrs)?.[1] || 0);
        const lastCell = new RegExp(`<c\\b[^>]*\\br="${column}24"[^>]*>`).exec(lastTemplateRow)?.[0] || '';
        const lastId = Number(/\bs="(\d+)"/.exec(lastCell)?.[1] || 0);
        const border = /\bborderId="(\d+)"/.exec(xfs[lastId])?.[1];
        if (!border) return all;
        const current = xfs[currentId] || newStyles[currentId - xfs.length];
        const nextId = xfs.length + newStyles.length;
        newStyles.push(current.replace(/\bborderId="\d+"/, `borderId="${border}"`));
        return `<c${attrs.replace(/\bs="\d+"/, `s="${nextId}"`)}>`;
      }).replace(/<row\b/, '<row thickBot="1"');
    }
    body.push(row);
  }

  const end = 4 + count;
  const footer = 26 + offset;
  const totals = (fuel: FuelDeliveryRow['fuel']) => rows.filter(row => row.kind === 'Salida' && row.fuel === fuel)
    .reduce((sum, row) => sum + row.gallons, 0);
  sheet = sheet.replace(/<sheetData>([\s\S]*?)<\/sheetData>/, (_all, data: string) => {
    const existing = data.match(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g) || [];
    const before = existing.filter(row => Number(/\br="(\d+)"/.exec(row)?.[1]) < 5);
    const after = existing.filter(row => Number(/\br="(\d+)"/.exec(row)?.[1]) >= 25).map(row => {
      const from = Number(/\br="(\d+)"/.exec(row)?.[1]);
      let shifted = moveRow(row, from + offset);
      if (from === 26) {
        for (const [column, mark, fuel] of [['K', 'C', 'ACPM'], ['N', 'D', 'Gasolina']] as const) {
          // An exit may literally have "Entrada" as its saved note. Its total
          // still follows the recorded movement type, not that coincidental text.
          const exceptions = rows.flatMap((item, i) => item.kind === 'Salida' && item.fuel === fuel
            && item.observations.toLowerCase() === 'entrada' ? [`E${i + 5}`] : []);
          const formula = `SUMIFS(E5:E${end},${mark}5:${mark}${end},"X",N5:N${end},"<>Entrada")`
            + (exceptions.length ? `+SUM(${exceptions.join(',')})` : '');
          if (formula.length > 8192) throw new Error('El total supera el límite de fórmula de Excel. Selecciona un período menor.');
          shifted = setCell(shifted, column, footer, {
            formula,
            result: totals(fuel),
          }, formattedStyle(shifted, column, footer, quantityFormat(totals(fuel))));
        }
      }
      return shifted;
    });
    return `<sheetData>${before.join('')}${body.join('')}${after.join('')}</sheetData>`;
  });
  const shiftReferences = (ref: string) => ref.replace(/([A-Z]+)(\d+)/g, (_all, col: string, n: string) => `${col}${Number(n) >= 25 ? Number(n) + offset : n}`);
  sheet = sheet.replace(/(<(?:dimension|mergeCell)\b[^>]*\bref=")([^"]+)"/g,
    (_all, prefix: string, ref: string) => `${prefix}${shiftReferences(ref)}"`);

  styles = styles.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,
    `<cellXfs count="${xfs.length + newStyles.length}">${xfsMatch[1]}${newStyles.join('')}</cellXfs>`);
  if (/<numFmts\b/.test(styles)) {
    styles = styles.replace(/<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/, (_all, old: string) =>
      `<numFmts count="${(old.match(/<numFmt\b/g) || []).length + newFormats.length}">${old}${newFormats.join('')}</numFmts>`);
  } else styles = styles.replace(/(<styleSheet\b[^>]*>)/, `$1<numFmts count="${newFormats.length}">${newFormats.join('')}</numFmts>`);

  const printNames = `<definedName name="_xlnm.Print_Area" localSheetId="0">'COMBUSTIBLE'!$A$1:$N$${28 + offset}</definedName>`
    + `<definedName name="_xlnm.Print_Titles" localSheetId="0">'COMBUSTIBLE'!$1:$4</definedName>`;
  if (/<definedNames\s*\/>/.test(workbook)) workbook = workbook.replace(/<definedNames\s*\/>/, `<definedNames>${printNames}</definedNames>`);
  else if (workbook.includes('</definedNames>')) workbook = workbook.replace('</definedNames>', `${printNames}</definedNames>`);
  else workbook = workbook.replace('</sheets>', `</sheets><definedNames>${printNames}</definedNames>`);
  workbook = workbook.replace(/<calcPr\b([^>]*?)\/>/, (_all, attributes: string) =>
    `<calcPr${attributes.replace(/\s+(?:fullCalcOnLoad|forceFullCalc)="[^"]*"/g, '')} fullCalcOnLoad="1" forceFullCalc="1"/>`);

  zip.file(SHEET_PATH, sheet);
  zip.file('xl/styles.xml', styles);
  zip.file('xl/workbook.xml', workbook);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function exportFuelTemplate(rows: readonly FuelDeliveryRow[]): Promise<Uint8Array> {
  if (!rows.length) throw new Error('No hay entradas o salidas de ACPM y gasolina para los filtros seleccionados.');
  const response = await fetch(FUEL_TEMPLATE_URL);
  if (!response.ok) throw new Error('No se pudo descargar el formato GA-F-006. Comprueba la conexión e inténtalo nuevamente.');
  return fillFuelTemplate(new Uint8Array(await response.arrayBuffer()), rows);
}
