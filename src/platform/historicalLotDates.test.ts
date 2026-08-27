import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { AgrochemicalLot } from '../agrochemicalLots';
import { crearReporteMovimientos, type InventarioParaReporte, type MovimientoParaReporte } from '../reporteMovimientosExcel';
import { generarReporteMovimientosExcelWeb } from './browserExcelExport';

const sulfato: InventarioParaReporte = {
  id: 'Q-FER152-COP', modulo: 'Agroquimicos', codigo: 'FER152',
  descripcion: 'SULCAMAG * 50KG - SULCAMAG', referencia: '', unidad: 'GRAMO',
  saldo_actual: 1309400, ubicacion: 'PORTUGUESA',
};
function movement(overrides: Partial<MovimientoParaReporte> = {}): MovimientoParaReporte {
  return {
    id: 'salida-junio', modulo: 'Agroquimicos', tipo: 'Salida', codigo: sulfato.codigo,
    descripcion: sulfato.descripcion, referencia: 'FER152', cantidad: 224400, unidad: 'GRAMO',
    fecha: '2026-06-12 10:51', solicitante: '', cargo: '', usuario: '', observaciones: '', fotoUrl: '',
    productDocumentId: 'Q-FER152-PORTUGUESA', documentId: 'Q-FER152-PORTUGUESA', ubicacion: 'PORTUGUESA',
    ...overrides,
  };
}
function lot(overrides: Partial<AgrochemicalLot> = {}): AgrochemicalLot {
  return {
    id: 'HIST-KARDEX-FER152__2027-02-03', productDocumentId: sulfato.id, productCode: sulfato.codigo,
    productName: sulfato.descripcion, lotNumber: 'HIST-KARDEX-FER152', expirationDate: '2027-02-03',
    quantity: 1309400, initialQuantity: 1309400, unit: 'GRAMO', location: 'PORTUGUESA', receivedAt: '', entryAssignments: [],
    ...overrides,
  };
}
function report(movements: MovimientoParaReporte[], inventory = [sulfato], lots = [lot()]) {
  return crearReporteMovimientos({
    moduleName: 'Agroquimicos', movimientos: movements, historialCompleto: movements,
    inventarioActual: inventory, lotesAgroquimicos: lots, usuarios: {}, periodLabel: 'Pruebas',
    exportDate: '', generatedBy: '', coverageLabel: '',
  });
}
async function workbook(payload: ReturnType<typeof report>) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await generarReporteMovimientosExcelWeb(payload)) as unknown as ExcelJS.Buffer);
  return wb;
}

describe('fechas de lotes en movimientos históricos', () => {
  it('incluye enero de 2028 en la entrada antigua de HAWKER sin inventar el día ni asignar sus 300 ML', async () => {
    const inventory = { ...sulfato, id: 'Q-INS009-BODEGA-AZUL', codigo: 'INS009', descripcion: 'HAWKER PLUS', unidad: 'ML', ubicacion: 'BODEGA AZUL', saldo_actual: 61 };
    const entry = movement({
      id: 'entrada-hawker', tipo: 'Entrada', codigo: 'INS009', descripcion: 'HAWKER PLUS', referencia: 'INS009',
      productDocumentId: inventory.id, documentId: inventory.id, ubicacion: 'BODEGA AZUL', unidad: 'ML', cantidad: 300, fecha: '2026-06-08 08:15',
    });
    const payload = report([entry], [inventory], [lot({ productDocumentId: inventory.id, lotNumber: '250602', expirationDate: '2028-01', quantity: 61 })]);
    expect(payload.entradasGenerales[0].lotes).toEqual([]);
    expect(payload.entradasGenerales[0].lotes_referencia).toEqual([{ numero: '250602', vencimiento: '2028-01' }]);
    const wb = await workbook(payload);
    for (const name of ['Entradas', 'Movimientos generales']) {
      const sheet = wb.getWorksheet(name)!;
      expect(sheet).toBeDefined();
      expect(sheet.getCell('I8').value).toBe('2028-01');
      expect(sheet.getCell('H8').value).toBe('250602 (referencia actual)');
      expect(sheet.getCell('C8').value).toBe(300);
      expect(sheet.getCell('E8').value).toEqual(new Date('2026-06-08T00:00:00Z'));
    }
  });

  it('recupera Sulcamag del 12/06/2026 aunque el QR antiguo diga PORTUGUESA y el ID actual termine en COP', async () => {
    const entry = movement();
    const currentLot = lot();
    const original = structuredClone({ entry, currentLot, sulfato });
    const payload = report([entry]);
    expect(payload.salidasGenerales[0].lotes).toEqual([]);
    expect(payload.salidasGenerales[0].lotes_referencia).toEqual([{ numero: 'HIST-KARDEX-FER152', vencimiento: '2027-02-03' }]);
    const sheet = (await workbook(payload)).getWorksheet('Salidas')!;
    expect(sheet.getCell('I8').value).toEqual(new Date('2027-02-03T00:00:00Z'));
    expect(sheet.getCell('F8').value).toEqual(new Date('2026-06-12T00:00:00Z'));
    expect(sheet.getCell('D8').value).toBe(224400);
    expect({ entry, currentLot, sulfato }).toEqual(original);
  });

  it('usa documento_id para Crento cuando producto_id contiene el código ENM020', async () => {
    const inventory = { ...sulfato, id: 'Q-ENM008-BODEGA-AZUL', codigo: 'ENM020', descripcion: 'CRENTO EQUILIBRIO CALCIO MAGNESIO', ubicacion: 'COP' };
    const exit = movement({ codigo: 'ENM020', descripcion: inventory.descripcion, productDocumentId: 'ENM020', documentId: inventory.id, ubicacion: 'COP', cantidad: 1550000 });
    const entry = { ...exit, id: 'entrada-crento', tipo: 'Entrada', cantidad: 34000000 };
    const currentLot = lot({ productDocumentId: inventory.id, lotNumber: '4300005339', expirationDate: '2031-07-01', entryAssignments: [{ entryId: entry.id, quantity: entry.cantidad }] });
    const payload = report([exit, entry], [inventory], [currentLot]);
    expect(payload.salidasGenerales[0].lotes_referencia).toEqual([{ numero: '4300005339', vencimiento: '2031-07-01' }]);
    expect(payload.entradasGenerales[0].lotes).toEqual([{ numero: '4300005339', vencimiento: '2031-07-01', cantidad: 34000000 }]);
    const wb = await workbook(payload);
    expect(wb.getWorksheet('Salidas')!.getCell('I8').value).toEqual(new Date('2031-07-01T00:00:00Z'));
    expect(wb.getWorksheet('Entradas')!.getCell('H8').text).not.toContain('referencia actual');
  });

  it.each([
    { ubicacion: '' }, { ubicacion: 'COP' }, { descripcion: 'OTRO SULCAMAG' },
    { unidad: 'ML' }, { productDocumentId: 'otro-producto', documentId: undefined },
  ])('no asigna referencias por una coincidencia incompleta: %j', (overrides) => {
    expect(report([movement(overrides)]).salidasGenerales[0].lotes_referencia).toEqual([]);
  });

  it('no elige entre dos existencias con el mismo código, nombre y ubicación', () => {
    const payload = report([movement()], [sulfato, { ...sulfato, id: 'duplicado' }]);
    expect(payload.salidasGenerales[0].lotes_referencia).toEqual([]);
  });

  it('no elige entre dos identificadores explícitos de productos diferentes', () => {
    const payload = report([movement({ productDocumentId: sulfato.id, documentId: 'otro' })], [sulfato, { ...sulfato, id: 'otro' }]);
    expect(payload.salidasGenerales[0].lotes_referencia).toEqual([]);
  });
});
