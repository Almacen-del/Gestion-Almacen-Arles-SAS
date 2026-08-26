import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { AgrochemicalLot } from '../agrochemicalLots';
import { crearReporteMovimientos, leerLotesSalidaReporte, type MovimientoParaReporte } from '../reporteMovimientosExcel';
import { modules } from '../theme';
import { generarReporteMovimientosExcelWeb } from './browserExcelExport';

const columnas = ['Nombre', 'Cantidad', 'Entrada', 'Salida', 'Fecha de ingreso', 'Fecha de salida', 'Observaciones'];
function movimiento(overrides: Partial<MovimientoParaReporte> = {}): MovimientoParaReporte {
  return {
    id: 'entrada', modulo: 'Agroquimicos', tipo: 'Entrada', codigo: 'FER001',
    descripcion: 'Fertilizante de prueba', referencia: 'Presentación 50 kg', cantidad: 50000,
    unidad: 'GRAMO', fecha: '2026-08-20T01:00:00.000Z', solicitante: '', cargo: '', usuario: '',
    observaciones: 'Recepción verificada. Datos ficticios para prueba.', fotoUrl: '', productDocumentId: 'producto',
    ...overrides,
  };
}
function lote(overrides: Partial<AgrochemicalLot> = {}): AgrochemicalLot {
  return {
    id: 'lote-a', productDocumentId: 'producto', productCode: 'FER001', productName: 'Fertilizante de prueba',
    lotNumber: 'LOTE-A', expirationDate: '2027-07', quantity: 20000, initialQuantity: 30000,
    unit: 'GRAMO', location: '', receivedAt: '2026-08-19', entryAssignments: [{ entryId: 'entrada', quantity: 30000 }],
    ...overrides,
  };
}
async function exportar(
  moduleName = 'Agroquimicos',
  movimientos = [movimiento({ modulo: moduleName })],
  lotes: AgrochemicalLot[] = [],
) {
  const payload = crearReporteMovimientos({
    moduleName, movimientos, historialCompleto: movimientos,
    inventarioActual: [{
      id: 'producto', modulo: moduleName, codigo: 'FER001', descripcion: 'Fertilizante de prueba',
      referencia: 'Presentación 50 kg', unidad: movimientos[0]?.unidad || 'GRAMO', saldo_actual: 35000,
      submodulo: movimientos[0]?.submodulo,
    }],
    lotesAgroquimicos: lotes, usuarios: {}, periodLabel: 'Agosto 2026 · DATOS DE PRUEBA',
    exportDate: '26 de agosto de 2026', generatedBy: 'Pruebas locales', coverageLabel: 'Muestra sin conexión a Firebase',
  });
  const bytes = await generarReporteMovimientosExcelWeb(payload);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return { wb, payload, bytes };
}

describe('Excel uniforme de los módulos', () => {
  it.each(modules.slice(2))('exporta %s con las columnas exactas y el mismo estilo en todas las hojas', async (modulo) => {
    const { wb } = await exportar(modulo);
    const esperadas = modulo === 'Agroquimicos' ? [...columnas, 'Lote', 'Fecha de vencimiento'] : columnas;
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(4);
    for (const sheet of wb.worksheets) {
      expect((sheet.getRow(7).values as ExcelJS.CellValue[]).slice(1)).toEqual(esperadas);
      expect(sheet.columnCount).toBe(esperadas.length);
      expect(sheet.getCell('A7').fill).toMatchObject({ fgColor: { argb: 'FF087B3B' } });
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 7 });
      expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 });
      expect(sheet.autoFilter).toBeTruthy();
      sheet.eachRow((row) => row.eachCell((cell) => {
        expect(cell.text).not.toMatch(/saldo anterior|saldo nuevo|stock antiguo|stock nuevo|existencia inicial/i);
        expect(cell.text).not.toMatch(/#REF!|#VALUE!|#DIV\/0!|#NAME\?/);
      }));
    }
  });

  it('conserva números, fracciones, unidades y fechas de Colombia; cantidad consolidada es el disponible real', async () => {
    const entrada = movimiento({ modulo: 'Dotación', cantidad: 1.2345, unidad: 'Unidad' });
    const salida = movimiento({ ...entrada, id: 'salida', tipo: 'Salida', cantidad: 0.25, fecha: '2026-08-22' });
    const { wb } = await exportar('Dotación', [entrada, salida]);
    const sheet = wb.getWorksheet('Movimientos generales')!;
    expect(sheet.getCell('B8').value).toBe(1.2345);
    expect(sheet.getCell('B8').numFmt).toContain('Unidad');
    expect(sheet.getCell('C8').value).toBe(1.2345);
    expect(sheet.getCell('D8').value).toBe(0);
    expect(sheet.getCell('E8').value).toEqual(new Date('2026-08-19T00:00:00Z'));
    expect(sheet.getCell('F8').value).toBeNull();
    expect(sheet.getCell('E9').value).toBeNull();
    expect(sheet.getCell('F9').value).toEqual(new Date('2026-08-22T00:00:00Z'));
    expect(sheet.getCell('D10').value).toEqual({ formula: 'SUBTOTAL(109,D8:D9)', result: 0.25 });
    expect(wb.getWorksheet('Consolidado por producto')!.getCell('B8').value).toBe(35000);
  });

  it('conserva la traza de varios lotes sin duplicar cantidades y respeta vencimientos sin día', async () => {
    const salida = movimiento({
      id: 'salida', tipo: 'Salida', cantidad: 15000, fecha: '2026-08-23',
      lotesSalida: leerLotesSalidaReporte({ lotes_salida: [
        { numero_lote: 'LOTE-A', fecha_vencimiento: '2027-07', cantidad: 10000 },
        { numero_lote: 'LOTE-B', fecha_vencimiento: '2028-01-31', cantidad: 5000 },
      ] }),
    });
    const lotes = [lote(), lote({ id: 'lote-b', lotNumber: 'LOTE-B', expirationDate: '2028-01-31', quantity: 15000, initialQuantity: 20000, entryAssignments: [{ entryId: 'entrada', quantity: 20000 }] })];
    const { wb, bytes, payload } = await exportar('Agroquimicos', [movimiento(), salida], lotes);
    expect(payload.entradasGenerales[0].lotes.map((l) => l.cantidad)).toEqual([30000, 20000]);
    expect(payload.categorias[0].consolidated[0].lotes.map((l) => l.cantidad)).toEqual([20000, 15000]);
    const sheet = wb.getWorksheet('Salidas')!;
    expect(sheet.getCell('D8').value).toBe(15000);
    expect(sheet.getCell('H8').value).toBe('LOTE-A (10.000 GRAMO)\nLOTE-B (5.000 GRAMO)');
    expect(sheet.getCell('I8').value).toBe('2027-07\n2028-01-31');
    expect(sheet.getCell('D9').value).toEqual({ formula: 'SUBTOTAL(109,D8:D8)', result: 15000 });
    if (process.env.EXCEL_EXPORT_QA_DIR) {
      await mkdir(process.env.EXCEL_EXPORT_QA_DIR, { recursive: true });
      await writeFile(join(process.env.EXCEL_EXPORT_QA_DIR, 'agroquimicos-prueba.xlsx'), bytes);
      const general = await exportar('EPP', [movimiento({ modulo: 'EPP', unidad: 'Unidad', cantidad: 5 })]);
      await writeFile(join(process.env.EXCEL_EXPORT_QA_DIR, 'epp-prueba.xlsx'), general.bytes);
    }
  });

  it('no atribuye lotes actuales a salidas antiguas ni lotes de otro producto a una entrada', async () => {
    const antiguos = movimiento({ id: 'antigua', tipo: 'Salida', cantidad: 5000 });
    const { wb, payload } = await exportar('Agroquimicos', [movimiento(), antiguos], [lote({ productDocumentId: 'otro-producto' })]);
    expect(payload.entradasGenerales[0].lotes).toEqual([]);
    expect(payload.salidasGenerales[0].lotes).toEqual([]);
    expect(wb.getWorksheet('Salidas')!.getCell('H8').value).toBe('Sin asignar (5.000 GRAMO)');
    expect(wb.getWorksheet('Salidas')!.getCell('I8').value).toBe('Sin fecha');
  });

  it('muestra cantidades pendientes y conserva el mes exacto de un único lote', async () => {
    const { wb } = await exportar('Agroquimicos', [movimiento()], [lote()]);
    expect(wb.getWorksheet('Entradas')!.getCell('H8').value).toBe('LOTE-A (30.000 GRAMO)\nSin asignar (20.000 GRAMO)');
    const completo = await exportar('Agroquimicos', [movimiento({ cantidad: 30000 })], [lote()]);
    expect(completo.wb.getWorksheet('Entradas')!.getCell('I8').value).toBe('2027-07');
  });

  it('no suma unidades incompatibles ni inventa fechas de productos sin movimientos', async () => {
    const mezcla = await exportar('Agroquimicos', [movimiento(), movimiento({ id: 'otra', unidad: 'ML' })]);
    expect(mezcla.wb.getWorksheet('Entradas')!.getCell('A10').value).toContain('unidades diferentes');
    const vacio = await exportar('EPP', []);
    expect(vacio.wb.getWorksheet('Movimientos generales')!.getCell('A8').value).toContain('Sin registros');
    expect(vacio.wb.getWorksheet('Consolidado por producto')!.getCell('E8').value).toBeNull();
    expect(vacio.wb.getWorksheet('Consolidado por producto')!.getCell('F8').value).toBeNull();
  });

  it('ignora trazas FEFO inválidas', () => {
    expect(leerLotesSalidaReporte({ lotes_salida: [null, 1, {}, { cantidad: -1 }, { cantidad: 'NaN' }] })).toEqual([]);
  });

  it('unifica también las hojas adicionales de los submódulos de Taller', async () => {
    const { wb, payload } = await exportar('TALLER', [
      movimiento({ modulo: 'TALLER', submodulo: 'MECANICA Y AJUSTE' }),
      movimiento({ id: 'segunda', modulo: 'TALLER', submodulo: 'ELECTRICIDAD', codigo: 'OTRO' }),
    ]);
    expect(payload.categorias.length).toBeGreaterThan(1);
    expect(wb.worksheets.length).toBe(4 + payload.categorias.length);
    for (const categoria of payload.categorias) {
      expect((wb.getWorksheet(categoria.sheetName)!.getRow(7).values as ExcelJS.CellValue[]).slice(1)).toEqual(columnas);
    }
  });
});
