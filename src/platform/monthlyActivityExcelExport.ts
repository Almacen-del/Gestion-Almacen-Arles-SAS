import ExcelJS from 'exceljs';
import { formatDestinationLot, groupMonthlyExpenses, isPersonnelExpense, summarizeMonthlyActivity, type MonthlyActivityRow, type MonthlyActivitySnapshot } from '../valuation/monthlyActivity';
import type { MonthlyValuationItem, MonthlyValuationSummary } from '../valuation/models';

const HEADER_ROW = 7;
const FIRST_DATA_ROW = 8;
const MONEY_FORMAT = '$ #,##0.######;[Red]-$ #,##0.######;"—"';
const QUANTITY_FORMAT = '#,##0.######;[Red]-#,##0.######;"—"';
const COLORS = {
  brand: 'FF16532C', green: 'FF087B3B', bright: 'FF11A84E', pale: 'FFE7F4E4',
  alternate: 'FFF4F9F5', text: 'FF172118', muted: 'FF5E7162', line: 'FFCDDCD0',
  white: 'FFFFFFFF', warning: 'FFFFF2D7', warningText: 'FF995D00', blue: 'FF2D6A8A',
};

export type MonthlyActivityExcelPayload = {
  summary: MonthlyValuationSummary;
  items: readonly MonthlyValuationItem[];
  snapshot: MonthlyActivitySnapshot;
  generatedBy?: string;
};

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function periodLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  const text = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function bogotaDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function excelDate(value: string): ExcelJS.CellValue {
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (zoned) {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return value;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant);
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
    return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!match) return value;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0)));
}

function quantityFactor(quantityUnit: string, priceUnit: string) {
  const unit = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.\s]/g, '');
  const aliases = (value: string) => {
    const key = unit(value);
    if (['g', 'gr', 'gramo', 'gramos'].includes(key)) return 'g';
    if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(key)) return 'kg';
    if (['ml', 'mililitro', 'mililitros'].includes(key)) return 'ml';
    if (['l', 'lt', 'litro', 'litros'].includes(key)) return 'l';
    if (['u', 'und', 'unidad', 'unidades'].includes(key)) return 'unidad';
    if (['par', 'pares'].includes(key)) return 'par';
    return key;
  };
  const from = aliases(quantityUnit);
  const to = aliases(priceUnit);
  if (from && from === to) return 1;
  if ((from === 'unidad' && to === 'par') || (from === 'par' && to === 'unidad')) return 1;
  if (from === 'kg' && to === 'g') return 1000;
  if (from === 'g' && to === 'kg') return 0.001;
  if (from === 'l' && to === 'ml') return 1000;
  if (from === 'ml' && to === 'l') return 0.001;
  return null;
}

function configureSheet(sheet: ExcelJS.Worksheet, widths: number[], title: string, subtitle: string, period: string, note: string, columns: string[]) {
  sheet.properties.defaultRowHeight = 24;
  sheet.properties.tabColor = { argb: COLORS.green };
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 1, showGridLines: false }];
  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    printTitlesRow: `1:${HEADER_ROW}`,
  };
  sheet.columns = widths.map((width) => ({ width }));
  const lastColumn = Math.max(columns.length, widths.length);
  const headings = [
    'ARLES S.A.S.  |  HISTÓRICO MENSUAL', title, `Período: ${periodLabel(period)}`,
    subtitle, note,
  ];
  headings.forEach((text, index) => {
    const rowNumber = index + 1;
    sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = text;
    cell.fill = fill(index === 0 ? COLORS.brand : COLORS.pale);
    cell.font = { name: 'Calibri', size: index < 2 ? 15 : 10, bold: index < 2, color: { argb: index === 0 ? COLORS.white : COLORS.brand } };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    sheet.getRow(rowNumber).height = index < 2 ? 30 : 27;
  });
  sheet.getRow(6).height = 10;
  const header = sheet.getRow(HEADER_ROW);
  header.values = columns;
  header.height = 32;
  header.eachCell((cell) => {
    cell.fill = fill(COLORS.green);
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  sheet.headerFooter.oddFooter = '&LARLES S.A.S.&CHistórico mensual&RPage &P de &N';
}

function styleDataRows(sheet: ExcelJS.Worksheet, rowCount: number, columnCount: number) {
  for (let index = 0; index < rowCount; index += 1) {
    const row = sheet.getRow(FIRST_DATA_ROW + index);
    row.height = 30;
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      cell.fill = fill(index % 2 ? COLORS.alternate : COLORS.white);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.text } };
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.line } } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    }
  }
}

function finishTable(sheet: ExcelJS.Worksheet, rowCount: number, columnCount: number) {
  const lastRow = Math.max(HEADER_ROW, HEADER_ROW + rowCount);
  const lastColumn = sheet.getColumn(columnCount).letter;
  sheet.autoFilter = `A${HEADER_ROW}:${lastColumn}${lastRow}`;
  sheet.pageSetup.printArea = `A1:${lastColumn}${lastRow}`;
}

function setNumberFormat(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, columns: readonly number[], format: string) {
  for (let row = startRow; row <= endRow; row += 1) {
    columns.forEach((column) => { sheet.getCell(row, column).numFmt = format; });
  }
}

function movementRows(sheet: ExcelJS.Worksheet, rows: readonly MonthlyActivityRow[], period: string, subtitle: string) {
  const columns = ['Fecha', 'Tipo', 'Código', 'Producto', 'Referencia', 'Módulo', 'Cantidad', 'Unidad', 'Lote de destino', 'Persona', 'Maquinaria', 'Precio base', 'Unidad precio', 'Factor de conversión', 'Gasto de salida', 'Estado', 'Clave producto', 'Clave persona'];
  configureSheet(sheet, [19, 12, 14, 34, 24, 19, 14, 14, 24, 24, 22, 16, 15, 11, 18, 20, 34, 28], 'Entradas y salidas', subtitle, period,
    'El gasto usa el precio unitario guardado en el corte mensual. Taller está excluido.', columns);
  rows.forEach((row, index) => {
    const excelRow = FIRST_DATA_ROW + index;
    const factor = row.unitValue === null ? null : quantityFactor(row.unit, row.priceUnit);
    const productKey = `${row.code || 'Sin código'} · ${row.product}`;
    const personKey = row.recipientId.startsWith('uid:') ? row.recipientId : (row.recipientId || row.recipientName).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    const status = row.kind === 'entry' ? 'No aplica' : row.expense === null ? row.issue || 'No sumada' : 'Valorada';
    const machinery = row.machinery?.trim() && !/^[\d\s.,-]+$/.test(row.machinery) ? row.machinery.trim() : 'No aplica';
    sheet.getRow(excelRow).values = [
      excelDate(row.occurredAt), row.kind === 'entry' ? 'Entrada' : 'Salida', row.code, row.product,
      row.reference === 'N/A' ? '' : row.reference, row.moduleName, row.quantity, row.unit,
      formatDestinationLot(row.destinationLot), row.recipientName, machinery, row.unitValue,
      row.priceUnit, factor, row.kind === 'exit' && row.expense !== null ? {
        formula: `G${excelRow}*L${excelRow}*N${excelRow}`, result: row.expense,
      } : null, status, productKey, personKey,
    ];
  });
  styleDataRows(sheet, rows.length, columns.length);
  if (!rows.length) {
    sheet.mergeCells('A8:R8');
    sheet.getCell('A8').value = 'No hay movimientos en este período.';
    styleDataRows(sheet, 1, columns.length);
  }
  const dataEnd = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + rows.length - 1);
  setNumberFormat(sheet, FIRST_DATA_ROW, dataEnd, [1], 'dd/mm/yyyy h:mm AM/PM');
  setNumberFormat(sheet, FIRST_DATA_ROW, dataEnd, [7], QUANTITY_FORMAT);
  setNumberFormat(sheet, FIRST_DATA_ROW, dataEnd, [12, 15], MONEY_FORMAT);
  setNumberFormat(sheet, FIRST_DATA_ROW, dataEnd, [14], '0.###');
  sheet.getColumn(14).hidden = true;
  sheet.getColumn(17).hidden = true;
  sheet.getColumn(18).hidden = true;
  finishTable(sheet, rows.length, columns.length);
}

function inventoryRows(sheet: ExcelJS.Worksheet, items: readonly MonthlyValuationItem[], period: string, subtitle: string) {
  const columns = ['Módulo', 'Código', 'Producto', 'Referencia', 'Cantidad', 'Unidad', 'Valor unitario', 'Valor total'];
  configureSheet(sheet, [20, 15, 38, 26, 16, 15, 18, 20], 'Inventario valorado del corte', subtitle, period,
    'Cantidad y valor unitario corresponden al corte guardado. El total se conserva como fórmula auditable.', columns);
  items.forEach((item, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    sheet.getRow(rowNumber).values = [item.moduleName, item.code, item.product, item.reference === 'N/A' ? '' : item.reference,
      item.quantity, item.unit, item.unitValue, { formula: `E${rowNumber}*G${rowNumber}`, result: item.totalValue }];
  });
  styleDataRows(sheet, items.length, columns.length);
  const end = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + items.length - 1);
  setNumberFormat(sheet, FIRST_DATA_ROW, end, [5], QUANTITY_FORMAT);
  setNumberFormat(sheet, FIRST_DATA_ROW, end, [7, 8], MONEY_FORMAT);
  finishTable(sheet, items.length, columns.length);
}

function groupedExpenseSheet(sheet: ExcelJS.Worksheet, rows: readonly MonthlyActivityRow[], period: string, grouping: 'lot' | 'module' | 'product') {
  const labels = { lot: 'Gasto por lote de destino', module: 'Gasto por módulo', product: 'Gasto por producto' } as const;
  const groups = groupMonthlyExpenses(rows, grouping);
  const columns = ['Grupo', 'Salidas', 'Valoradas', 'No sumadas', 'Gasto estimado'];
  configureSheet(sheet, [42, 14, 14, 15, 20], labels[grouping], `${groups.length} grupos`, period,
    'Las salidas no valoradas se muestran, pero no se suman. Los totales concilian con la hoja Movimientos.', columns);
  const movementEnd = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + rows.length - 1);
  const criterionColumn = grouping === 'lot' ? 'I' : grouping === 'module' ? 'F' : 'Q';
  groups.forEach((group, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const criterion = grouping === 'product' ? group.label : group.label;
    const quoted = `'Movimientos'!$${criterionColumn}$${FIRST_DATA_ROW}:$${criterionColumn}$${movementEnd}`;
    const typeRange = `'Movimientos'!$B$${FIRST_DATA_ROW}:$B$${movementEnd}`;
    const statusRange = `'Movimientos'!$P$${FIRST_DATA_ROW}:$P$${movementEnd}`;
    const expenseRange = `'Movimientos'!$O$${FIRST_DATA_ROW}:$O$${movementEnd}`;
    sheet.getRow(rowNumber).values = [
      criterion,
      { formula: `COUNTIFS(${typeRange},"Salida",${quoted},A${rowNumber})`, result: group.rows.length },
      { formula: `COUNTIFS(${typeRange},"Salida",${quoted},A${rowNumber},${statusRange},"Valorada")`, result: group.rows.length - group.unpriced },
      { formula: `COUNTIFS(${typeRange},"Salida",${quoted},A${rowNumber},${statusRange},"<>Valorada")`, result: group.unpriced },
      { formula: `SUMIFS(${expenseRange},${typeRange},"Salida",${quoted},A${rowNumber})`, result: group.expense },
    ];
  });
  styleDataRows(sheet, groups.length, columns.length);
  const end = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + groups.length - 1);
  setNumberFormat(sheet, FIRST_DATA_ROW, end, [5], MONEY_FORMAT);
  finishTable(sheet, groups.length, columns.length);
  return groups;
}

function personnelExpenseSheet(sheet: ExcelJS.Worksheet, rows: readonly MonthlyActivityRow[], period: string) {
  const groups = groupMonthlyExpenses(rows.filter(isPersonnelExpense), 'person');
  const columns = ['Persona', 'Productos recibidos', 'Salidas', 'No sumadas', 'Gasto estimado', 'Clave'];
  configureSheet(sheet, [30, 56, 14, 15, 20, 28], 'Dotación y EPP por persona', `${groups.length} personas`, period,
    'Incluye únicamente Dotación y EPP. Cada persona conserva el detalle de los productos adquiridos.', columns);
  const movementEnd = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + rows.length - 1);
  groups.forEach((group, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const products = [...new Set(group.rows.map((row) => `${row.code || 'Sin código'} · ${row.product}`))].join('\n');
    const personRange = `'Movimientos'!$R$${FIRST_DATA_ROW}:$R$${movementEnd}`;
    const typeRange = `'Movimientos'!$B$${FIRST_DATA_ROW}:$B$${movementEnd}`;
    const statusRange = `'Movimientos'!$P$${FIRST_DATA_ROW}:$P$${movementEnd}`;
    const expenseRange = `'Movimientos'!$O$${FIRST_DATA_ROW}:$O$${movementEnd}`;
    sheet.getRow(rowNumber).values = [group.label, products,
      { formula: `COUNTIFS(${typeRange},"Salida",${personRange},F${rowNumber})`, result: group.rows.length },
      { formula: `COUNTIFS(${typeRange},"Salida",${personRange},F${rowNumber},${statusRange},"<>Valorada")`, result: group.unpriced },
      { formula: `SUMIFS(${expenseRange},${typeRange},"Salida",${personRange},F${rowNumber})`, result: group.expense }, group.id];
  });
  styleDataRows(sheet, groups.length, columns.length);
  groups.forEach((group, index) => {
    const products = [...new Set(group.rows.map((row) => `${row.code || 'Sin código'} · ${row.product}`))];
    sheet.getRow(FIRST_DATA_ROW + index).height = Math.min(120, Math.max(30, products.length * 15 + 8));
  });
  const end = Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + groups.length - 1);
  setNumberFormat(sheet, FIRST_DATA_ROW, end, [5], MONEY_FORMAT);
  sheet.getColumn(6).hidden = true;
  finishTable(sheet, groups.length, columns.length);
  return groups;
}

function summarySheet(workbook: ExcelJS.Workbook, payload: MonthlyActivityExcelPayload, subtitle: string) {
  const { summary, items, snapshot } = payload;
  const totals = summarizeMonthlyActivity(snapshot.rows);
  const sheet = workbook.addWorksheet('Resumen', { properties: { tabColor: { argb: COLORS.brand } }, views: [{ showGridLines: false }] });
  sheet.columns = Array.from({ length: 12 }, () => ({ width: 16 }));
  sheet.mergeCells('A1:L2');
  sheet.getCell('A1').value = `ARLES S.A.S.  |  HISTÓRICO MENSUAL · ${periodLabel(summary.period).toLocaleUpperCase()}`;
  sheet.getCell('A1').fill = fill(COLORS.brand);
  sheet.getCell('A1').font = { name: 'Calibri', size: 20, bold: true, color: { argb: COLORS.white } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 30; sheet.getRow(2).height = 22;
  sheet.mergeCells('A3:L3');
  sheet.getCell('A3').value = `${subtitle} · Exportado: ${bogotaDateTime(new Date())}`;
  sheet.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: COLORS.muted } };

  const cards = [
    ['A5:C5', 'A6:C7', 'Valor total del inventario', { formula: `SUM('Inventario del corte'!H${FIRST_DATA_ROW}:H${Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + items.length - 1)})`, result: summary.totalValue }, MONEY_FORMAT],
    ['D5:F5', 'D6:F7', 'Productos del corte', summary.productCount, '#,##0'],
    ['G5:I5', 'G6:I7', 'Entradas del mes', totals.entryCount, '#,##0'],
    ['J5:L5', 'J6:L7', 'Salidas del mes', totals.exitCount, '#,##0'],
    ['A9:C9', 'A10:C11', 'Gasto mensual estimado', { formula: `SUM('Movimientos'!O${FIRST_DATA_ROW}:O${Math.max(FIRST_DATA_ROW, FIRST_DATA_ROW + snapshot.rows.length - 1)})`, result: totals.estimatedExpense }, MONEY_FORMAT],
    ['D9:F9', 'D10:F11', 'Salidas no sumadas', totals.unpricedExitCount, '#,##0'],
    ['G9:I9', 'G10:I11', 'Productos con valor', summary.valuedProductCount, '#,##0'],
    ['J9:L9', 'J10:L11', 'Cobertura valorada', summary.valuedPercentage / 100, '0.0%'],
  ] as const;
  cards.forEach(([labelRange, valueRange, label, value, numberFormat]) => {
    sheet.mergeCells(labelRange); sheet.mergeCells(valueRange);
    const labelCell = sheet.getCell(labelRange.split(':')[0]);
    const valueCell = sheet.getCell(valueRange.split(':')[0]);
    labelCell.value = label; labelCell.fill = fill(COLORS.pale);
    labelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.brand } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    valueCell.value = value as ExcelJS.CellValue; valueCell.fill = fill(COLORS.white);
    valueCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: COLORS.brand } };
    valueCell.alignment = { vertical: 'middle', horizontal: 'right' };
    valueCell.numFmt = numberFormat;
    labelCell.border = { top: { style: 'thin', color: { argb: COLORS.line } }, left: { style: 'thin', color: { argb: COLORS.line } }, right: { style: 'thin', color: { argb: COLORS.line } } };
    valueCell.border = { bottom: { style: 'thin', color: { argb: COLORS.line } }, left: { style: 'thin', color: { argb: COLORS.line } }, right: { style: 'thin', color: { argb: COLORS.line } } };
  });

  sheet.mergeCells('A14:F14'); sheet.getCell('A14').value = 'Valor del inventario por módulo';
  sheet.mergeCells('H14:L14'); sheet.getCell('H14').value = 'Control del corte';
  for (const cell of [sheet.getCell('A14'), sheet.getCell('H14')]) {
    cell.fill = fill(COLORS.green); cell.font = { bold: true, color: { argb: COLORS.white } }; cell.alignment = { indent: 1 };
  }
  sheet.getCell('A15').value = 'Módulo'; sheet.getCell('B15').value = 'Valor';
  sheet.getCell('H15').value = 'Dato'; sheet.getCell('I15').value = 'Resultado';
  const modules = Object.entries(summary.moduleTotals).sort((left, right) => right[1] - left[1]);
  modules.forEach(([moduleName, value], index) => {
    const row = 16 + index; sheet.getCell(row, 1).value = moduleName; sheet.getCell(row, 2).value = value; sheet.getCell(row, 2).numFmt = MONEY_FORMAT;
  });
  const controls: [string, ExcelJS.CellValue][] = [
    ['Fecha exacta del corte', summary.createdAt ? bogotaDateTime(summary.createdAt) : snapshot.cutoffAt],
    ['Creado por', summary.createdBy || payload.generatedBy || 'Sin usuario registrado'],
    ['Registros excluidos por fecha', snapshot.invalidDateCount],
    ['Registros excluidos por cantidad', snapshot.invalidQuantityCount],
    ['Taller', 'Excluido del informe'],
    ['Criterio del gasto', 'Precio unitario guardado en el corte'],
  ];
  controls.forEach(([label, value], index) => { const row = 16 + index; sheet.getCell(row, 8).value = label; sheet.getCell(row, 9).value = value; });
  const lastSummaryRow = Math.max(21, 15 + modules.length);
  for (let row = 15; row <= lastSummaryRow; row += 1) {
    for (const column of [1, 2, 8, 9]) {
      const cell = sheet.getCell(row, column); cell.border = { bottom: { style: 'hair', color: { argb: COLORS.line } } };
      cell.font = { name: 'Calibri', size: 10, bold: row === 15 || column === 1 || column === 8, color: { argb: COLORS.text } };
      cell.fill = fill(row % 2 ? COLORS.alternate : COLORS.white); cell.alignment = { vertical: 'middle', wrapText: true };
    }
  }
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  sheet.pageSetup.printArea = `A1:L${lastSummaryRow}`;
  sheet.headerFooter.oddFooter = '&LARLES S.A.S.&CResumen del histórico mensual&RPage &P de &N';
  return sheet;
}

type ChartDatum = { label: string; value: number };

function chartCanvas(title: string, data: readonly ChartDatum[], currency = true, vertical = false) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 1100; canvas.height = 500;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#16532C'; context.font = 'bold 28px Calibri, Arial'; context.fillText(title, 34, 44);
  const values = data.slice(0, 10);
  if (!values.length) {
    context.fillStyle = '#5E7162'; context.font = '22px Calibri, Arial'; context.fillText('Sin datos para graficar.', 34, 100);
    return canvas.toDataURL('image/png');
  }
  const maximum = Math.max(...values.map((entry) => entry.value), 1);
  const valueText = (value: number) => currency
    ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0, notation: value >= 1_000_000 ? 'compact' : 'standard' }).format(value)
    : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
  if (vertical) {
    const left = 75; const bottom = 425; const top = 80; const usable = bottom - top; const width = 850 / values.length;
    values.forEach((entry, index) => {
      const height = (entry.value / maximum) * usable;
      context.fillStyle = index % 2 ? '#11A84E' : '#087B3B';
      context.fillRect(left + index * width + 12, bottom - height, Math.max(30, width - 28), height);
      context.fillStyle = '#172118'; context.font = '18px Calibri, Arial'; context.textAlign = 'center';
      context.fillText(valueText(entry.value), left + index * width + width / 2, bottom - height - 10);
      context.fillText(entry.label.slice(0, 16), left + index * width + width / 2, bottom + 30);
    });
  } else {
    const labelWidth = 310; const barLeft = 330; const maxWidth = 600; const rowHeight = 38;
    values.forEach((entry, index) => {
      const y = 78 + index * rowHeight;
      context.fillStyle = '#172118'; context.font = '18px Calibri, Arial'; context.textAlign = 'right';
      context.fillText(entry.label.length > 30 ? `${entry.label.slice(0, 29)}…` : entry.label, labelWidth, y + 22);
      context.fillStyle = index % 2 ? '#11A84E' : '#087B3B'; context.fillRect(barLeft, y, Math.max(2, (entry.value / maximum) * maxWidth), 25);
      context.fillStyle = '#172118'; context.textAlign = 'left'; context.fillText(valueText(entry.value), barLeft + (entry.value / maximum) * maxWidth + 10, y + 21);
    });
  }
  return canvas.toDataURL('image/png');
}

function chartsSheet(workbook: ExcelJS.Workbook, payload: MonthlyActivityExcelPayload, moduleGroups: ReturnType<typeof groupMonthlyExpenses>, lotGroups: ReturnType<typeof groupMonthlyExpenses>, productGroups: ReturnType<typeof groupMonthlyExpenses>, personGroups: ReturnType<typeof groupMonthlyExpenses>) {
  const sheet = workbook.addWorksheet('Gráficas', { properties: { tabColor: { argb: COLORS.bright } }, views: [{ showGridLines: false }] });
  sheet.columns = Array.from({ length: 18 }, () => ({ width: 10 }));
  sheet.mergeCells('A1:R2'); sheet.getCell('A1').value = `ARLES S.A.S.  |  GRÁFICAS · ${periodLabel(payload.summary.period).toLocaleUpperCase()}`;
  sheet.getCell('A1').fill = fill(COLORS.brand); sheet.getCell('A1').font = { size: 20, bold: true, color: { argb: COLORS.white } }; sheet.getCell('A1').alignment = { indent: 1, vertical: 'middle' };
  sheet.mergeCells('A3:R3'); sheet.getCell('A3').value = 'Cada gráfica corresponde a los datos completos del corte, no a los filtros visibles en pantalla.';
  sheet.getCell('A3').font = { color: { argb: COLORS.muted }, italic: true };
  const movementTotals = summarizeMonthlyActivity(payload.snapshot.rows);
  const charts = [
    chartCanvas('Entradas y salidas', [{ label: 'Entradas', value: movementTotals.entryCount }, { label: 'Salidas', value: movementTotals.exitCount }], false, true),
    chartCanvas('Valor del inventario por módulo', Object.entries(payload.summary.moduleTotals).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))),
    chartCanvas('Gasto estimado por módulo', moduleGroups.map((group) => ({ label: group.label, value: group.expense }))),
    chartCanvas('Lotes con mayor gasto', lotGroups.map((group) => ({ label: group.label, value: group.expense })).filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value)),
    chartCanvas('Productos con mayor gasto', productGroups.map((group) => ({ label: group.label, value: group.expense })).filter((entry) => entry.value > 0)),
    chartCanvas('Dotación y EPP por persona', personGroups.map((group) => ({ label: group.label, value: group.expense })).filter((entry) => entry.value > 0)),
  ];
  const positions = [
    { tl: { col: 0, row: 4 }, ext: { width: 720, height: 330 } }, { tl: { col: 9, row: 4 }, ext: { width: 720, height: 330 } },
    { tl: { col: 0, row: 22 }, ext: { width: 720, height: 330 } }, { tl: { col: 9, row: 22 }, ext: { width: 720, height: 330 } },
    { tl: { col: 0, row: 40 }, ext: { width: 720, height: 330 } }, { tl: { col: 9, row: 40 }, ext: { width: 720, height: 330 } },
  ];
  charts.forEach((base64, index) => {
    if (!base64) return;
    const imageId = workbook.addImage({ base64, extension: 'png' });
    sheet.addImage(imageId, positions[index]);
  });
  if (!charts.some(Boolean)) {
    sheet.mergeCells('A6:R10'); sheet.getCell('A6').value = 'Las gráficas se generan al exportar desde el navegador.';
    sheet.getCell('A6').alignment = { horizontal: 'center', vertical: 'middle' }; sheet.getCell('A6').font = { size: 14, color: { argb: COLORS.muted } };
  }
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.pageSetup.printArea = 'A1:R58';
}

export async function generateMonthlyActivityExcel(payload: MonthlyActivityExcelPayload): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = payload.generatedBy || payload.summary.createdBy || 'ARLES S.A.S.';
  workbook.company = 'ARLES S.A.S.';
  workbook.title = `Histórico mensual ${periodLabel(payload.summary.period)}`;
  workbook.subject = 'Inventario, movimientos y gasto mensual';
  workbook.calcProperties.fullCalcOnLoad = true;
  const subtitle = `Corte: ${bogotaDateTime(payload.snapshot.cutoffAt)} · ${payload.snapshot.rows.length} movimientos`;

  summarySheet(workbook, payload, subtitle);
  inventoryRows(workbook.addWorksheet('Inventario del corte'), payload.items, payload.summary.period, subtitle);
  movementRows(workbook.addWorksheet('Movimientos'), payload.snapshot.rows, payload.summary.period, subtitle);
  movementRows(workbook.addWorksheet('Entradas'), payload.snapshot.rows.filter((row) => row.kind === 'entry'), payload.summary.period, subtitle);
  movementRows(workbook.addWorksheet('Salidas'), payload.snapshot.rows.filter((row) => row.kind === 'exit'), payload.summary.period, subtitle);
  const lotGroups = groupedExpenseSheet(workbook.addWorksheet('Gasto por lote'), payload.snapshot.rows, payload.summary.period, 'lot');
  const moduleGroups = groupedExpenseSheet(workbook.addWorksheet('Gasto por módulo'), payload.snapshot.rows, payload.summary.period, 'module');
  const productGroups = groupedExpenseSheet(workbook.addWorksheet('Gasto por producto'), payload.snapshot.rows, payload.summary.period, 'product');
  const personGroups = personnelExpenseSheet(workbook.addWorksheet('Dotación EPP por persona'), payload.snapshot.rows, payload.summary.period);
  chartsSheet(workbook, payload, moduleGroups, lotGroups, productGroups, personGroups);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export function monthlyActivityExcelFilename(period: string) {
  return `Historico_Mensual_ARLES_${period}.xlsx`;
}
