import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { MonthlyActivityRow, MonthlyActivitySnapshot } from '../valuation/monthlyActivity';
import type { MonthlyValuationItem, MonthlyValuationSummary } from '../valuation/models';
import { generateMonthlyActivityExcel, monthlyActivityExcelFilename } from './monthlyActivityExcelExport';

const items: MonthlyValuationItem[] = [{
  id: 'combustible__gas1', moduleName: 'Combustible', code: 'GAS1', product: 'Gasolina', reference: 'Líquidos',
  quantity: 100, unit: 'Galones', unitValue: 17_000, totalValue: 1_700_000,
}, {
  id: 'epp__e1', moduleName: 'EPP', code: 'E1', product: 'Guante', reference: 'Talla 9',
  quantity: 10, unit: 'Unidad', unitValue: 20_000, totalValue: 200_000,
}];

const rows: MonthlyActivityRow[] = [{
  id: 'entrada', kind: 'entry', occurredAt: '2026-08-02 08:30', moduleName: 'Combustible', productId: 'combustible__gas1',
  code: 'GAS1', product: 'Gasolina', reference: 'Líquidos', quantity: 100, unit: 'Galones', destinationLot: 'Sin lote de destino',
  recipientId: 'proveedor', recipientName: 'Proveedor', machinery: '', unitValue: 17_000, priceUnit: 'Galones', expense: null, issue: '',
}, {
  id: 'salida-gas', kind: 'exit', occurredAt: '2026-08-13T13:11:00.000Z', moduleName: 'Combustible', productId: 'combustible__gas1',
  code: 'GAS1', product: 'Gasolina', reference: 'Líquidos', quantity: 7, unit: 'Galones', destinationLot: 'Plantación',
  recipientId: 'elio', recipientName: 'Elio Lozada', machinery: 'Moto 32H y 21G', unitValue: 17_000, priceUnit: 'Galones', expense: 119_000, issue: '',
}, {
  id: 'salida-epp', kind: 'exit', occurredAt: '2026-08-20 09:15', moduleName: 'EPP', productId: 'epp__e1',
  code: 'E1', product: 'Guante', reference: 'Talla 9', quantity: 2, unit: 'Unidad', destinationLot: 'Personal',
  recipientId: 'uid:persona', recipientName: 'Ana Pérez', machinery: '', unitValue: 20_000, priceUnit: 'Par', expense: 40_000, issue: '',
}, {
  id: 'sin-precio', kind: 'exit', occurredAt: '2026-08-21 10:00', moduleName: 'ASEO', productId: 'aseo__a1',
  code: 'A1', product: 'Producto sin precio', reference: '', quantity: 1, unit: 'Unidad', destinationLot: 'Cocina',
  recipientId: 'persona', recipientName: 'Persona', machinery: '47', unitValue: null, priceUnit: '', expense: null, issue: 'Sin precio',
}];

const snapshot: MonthlyActivitySnapshot = {
  period: '2026-08', cutoffAt: '2026-08-26T18:00:00.000Z', invalidDateCount: 1, invalidQuantityCount: 0, rows,
};

const summary: MonthlyValuationSummary = {
  period: '2026-08', totalValue: 1_900_000, productCount: 2, valuedProductCount: 2, unvaluedProductCount: 0,
  valuedPercentage: 100, moduleTotals: { Combustible: 1_700_000, EPP: 200_000 }, createdAt: new Date('2026-08-26T18:00:00.000Z'),
  createdBy: 'Pruebas ARLES', createdByUid: 'uid', status: 'completo', activity: null,
};

async function workbook() {
  const bytes = await generateMonthlyActivityExcel({ summary, items, snapshot, generatedBy: 'Pruebas ARLES' });
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return { result, bytes };
}

describe('Excel del histórico mensual', () => {
  it('organiza todo el informe en hojas uniformes, auditables y sin columnas de stock antiguo/nuevo', async () => {
    const { result } = await workbook();
    expect(result.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumen', 'Inventario del corte', 'Movimientos', 'Entradas', 'Salidas', 'Gasto por lote',
      'Gasto por módulo', 'Gasto por producto', 'Dotación EPP por persona', 'Gráficas',
    ]);
    expect(result.getWorksheet('Resumen')!.getCell('A1').text).toContain('HISTÓRICO MENSUAL');
    expect(result.getWorksheet('Resumen')!.getCell('A6').value).toMatchObject({ formula: expect.stringContaining("'Inventario del corte'!H8:H9"), result: 1_900_000 });
    expect(result.getWorksheet('Resumen')!.getCell('A10').value).toMatchObject({ formula: expect.stringContaining("'Movimientos'!O8:O11"), result: 159_000 });

    const movements = result.getWorksheet('Movimientos')!;
    expect((movements.getRow(7).values as ExcelJS.CellValue[]).slice(1, 17)).toEqual([
      'Fecha', 'Tipo', 'Código', 'Producto', 'Referencia', 'Módulo', 'Cantidad', 'Unidad', 'Lote de destino',
      'Persona', 'Maquinaria', 'Precio base', 'Unidad precio', 'Factor de conversión', 'Gasto de salida', 'Estado',
    ]);
    expect(movements.getCell('K8').value).toBe('No aplica');
    expect(movements.getCell('I9').value).toBe('Lote Plantación');
    expect(movements.getCell('K9').value).toBe('Moto 32H y 21G');
    expect(movements.getCell('N10').value).toBe(1);
    expect(movements.getCell('K11').value).toBe('No aplica');
    expect(movements.getCell('O9').value).toEqual({ formula: 'G9*L9*N9', result: 119_000 });
    expect(movements.getCell('P11').value).toBe('Sin precio');
    expect(movements.views[0]).toMatchObject({ state: 'frozen', ySplit: 7, xSplit: 1 });
    expect(movements.autoFilter).toBeTruthy();
    expect(movements.getColumn(14).hidden).toBe(true);
    expect(movements.getColumn(17).hidden).toBe(true);
    expect(movements.getColumn(18).hidden).toBe(true);

    for (const sheet of result.worksheets) sheet.eachRow((row) => row.eachCell((cell) => {
      expect(cell.text).not.toMatch(/stock antiguo|stock nuevo|saldo anterior|saldo nuevo/i);
      expect(cell.text).not.toMatch(/#REF!|#VALUE!|#DIV\/0!|#NAME\?/);
    }));
  });

  it('concilia gastos por lote, módulo, producto y persona con el detalle de movimientos', async () => {
    const { result } = await workbook();
    const lotSheet = result.getWorksheet('Gasto por lote')!;
    const personalLotRow = lotSheet.getColumn(1).values.findIndex((value) => value === 'Lote Personal');
    expect(lotSheet.getCell(personalLotRow, 5).value).toMatchObject({ result: 40_000 });
    const moduleSheet = result.getWorksheet('Gasto por módulo')!;
    const moduleValues = moduleSheet.getColumn(1).values;
    const fuelRow = moduleValues.findIndex((value) => value === 'Combustible');
    expect(moduleSheet.getCell(fuelRow, 5).value).toMatchObject({ result: 119_000 });
    const productSheet = result.getWorksheet('Gasto por producto')!;
    const gasRow = productSheet.getColumn(1).values.findIndex((value) => value === 'GAS1 · Gasolina');
    expect(productSheet.getCell(gasRow, 5).value).toMatchObject({ result: 119_000 });
    const personSheet = result.getWorksheet('Dotación EPP por persona')!;
    expect(personSheet.getCell('A8').value).toBe('Ana Pérez');
    expect(personSheet.getCell('B8').value).toBe('E1 · Guante');
    expect(personSheet.getCell('E8').value).toMatchObject({ result: 40_000 });
  });

  it('usa un nombre claro y permite guardar una muestra para revisión visual', async () => {
    expect(monthlyActivityExcelFilename('2026-08')).toBe('Historico_Mensual_ARLES_2026-08.xlsx');
    const { bytes } = await workbook();
    if (process.env.MONTHLY_ACTIVITY_EXPORT_QA_DIR) {
      await mkdir(process.env.MONTHLY_ACTIVITY_EXPORT_QA_DIR, { recursive: true });
      await writeFile(join(process.env.MONTHLY_ACTIVITY_EXPORT_QA_DIR, monthlyActivityExcelFilename(summary.period)), bytes);
    }
  });
});
