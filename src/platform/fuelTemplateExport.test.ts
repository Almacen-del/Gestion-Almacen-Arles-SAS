import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { fillFuelTemplate, FUEL_TEMPLATE_URL } from './fuelTemplateExport';
import { generarReporteMovimientosExcelWeb } from './browserExcelExport';
import { crearReporteMovimientos } from '../reporteMovimientosExcel';
import { createFuelDeliveryRows, type FuelDeliveryRow } from '../fuelDeliveryReport';

const templatePath = 'public/templates/GA-F-006-combustible-v002.xlsx';
const input = (i: number): FuelDeliveryRow => ({ id: `test-${i}`, kind: i % 3 === 0 ? 'Entrada' : 'Salida', fuel: i % 2 ? 'Gasolina' : 'ACPM',
  dateSerial: 46214 + i, gallons: i + 0.125, hourMeter: '0123,5', machinery: 'Tractor 3', plate: 'ABC012',
  labor: 'Limpieza de canales', destination: '24, 25 y 10B', receiver: 'Persona receptora de prueba',
  deliverer: 'Responsable del movimiento', company: 'ARLES SAS', observations: i % 3 === 0 ? 'Entrada' : 'Observación guardada del movimiento' });
async function generate(rows: FuelDeliveryRow[]) {
  const original = await readFile(templatePath);
  const bytes = await fillFuelTemplate(original, rows);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return { original, bytes, workbook, sheet: workbook.getWorksheet('COMBUSTIBLE')! };
}
afterEach(() => vi.unstubAllGlobals());

describe('exportación en la plantilla nativa GA-F-006', () => {
  it('conserva cada parte nativa ajena a las celdas, rangos y formatos numéricos necesarios', async () => {
    const { original, bytes, sheet, workbook } = await generate([input(1), input(2)]);
    expect(createHash('sha256').update(original).digest('hex')).toBe('63f98bb487ec4d63c4a052241e680114e48cbc16ca2e8c4cbfd37004870a04fe');
    const before = await JSZip.loadAsync(original), after = await JSZip.loadAsync(bytes);
    const modified = ['xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/workbook.xml'];
    expect(Object.keys(after.files).filter(key => !after.files[key].dir).sort()).toEqual(Object.keys(before.files).filter(key => !before.files[key].dir).sort());
    for (const path of Object.keys(before.files).filter(key => !before.files[key].dir && !modified.includes(key))) {
      expect(await after.file(path)!.async('uint8array'), path).toEqual(await before.file(path)!.async('uint8array'));
    }
    expect(workbook.worksheets.map(s => s.name)).toEqual(['COMBUSTIBLE', 'CONTROL DE CAMBIOS']);
    expect(sheet.getImages()).toHaveLength(1);
    expect(sheet.getCell('C1').text).toContain('CONTROL Y SEGUIMIENTO ENTREGA');
    expect(sheet.getCell('M2').text).toBe('VERSION: 002');
    expect(sheet.getCell('A27').text).toBe('AUTORIZA');
    expect(sheet.getCell('N5').text).toBe(input(1).observations);
    expect(sheet.getCell('E5').value).toBe(1.125);
    expect(sheet.getCell('B5').value).toBeInstanceOf(Date);
    expect(sheet.getCell('H5').value).toBe('ABC012');
    expect(sheet.getCell('F5').value).toBe('0123,5');
    expect(sheet.pageSetup.orientation).toBe('landscape');
    expect(sheet.pageSetup.scale).toBe(58);
    expect(sheet.getColumn('N').width).toBe(33);
    expect(sheet.getColumn('K').width).toBe(28);
  });
  it.each([20, 21, 22, 47])('extiende %s movimientos sin cortar en 20 ni pisar firmas, totales o control de cambios', async count => {
    const rows = Array.from({ length: count }, (_, i) => input(i + 1));
    const { sheet, bytes } = await generate(rows);
    expect(sheet.getCell(`A${count + 4}`).value).toBe(count);
    expect(sheet.getCell(`N${count + 4}`).text).toBe(rows.at(-1)!.observations);
    expect(sheet.getCell(`K${count + 5}`).text).toBe('TOTAL GL ACPM:');
    expect(sheet.getCell(`A${count + 7}`).text).toBe('AUTORIZA');
    expect(sheet.getCell(`L${count + 8}`).text).toContain('SE DESPACHA');
    expect(sheet.pageSetup.printArea).toBe(`A1:N${count + 8}`);
    expect(sheet.pageSetup.printTitlesRow).toBe('1:4');
    const originalBook = new ExcelJS.Workbook();
    await originalBook.xlsx.readFile(templatePath);
    expect(sheet.getCell(`N${count + 4}`).border).toEqual(originalBook.getWorksheet('COMBUSTIBLE')!.getCell('N24').border);
    expect(sheet.getCell(`K${count + 6}`).value).toMatchObject({ result: rows.filter(r => r.fuel === 'ACPM' && r.kind === 'Salida').reduce((s, r) => s + r.gallons, 0) });
    expect(sheet.getCell(`N${count + 6}`).value).toMatchObject({ result: rows.filter(r => r.fuel === 'Gasolina' && r.kind === 'Salida').reduce((s, r) => s + r.gallons, 0) });
    if (count === 47) expect(sheet.getCell(`N${count + 6}`).numFmt).toBe('0');
    if (count === 47 && process.env.FUEL_REPORT_QA === '1') {
      await mkdir('outputs/fuel-form-20260906', { recursive: true });
      await writeFile('outputs/fuel-form-20260906/GA-F-006-prueba-local.xlsx', bytes);
    }
  });
  it('escapa texto y fórmulas del solicitante/observación y permite filas más altas sin cambiar anchos', async () => {
    const row = { ...input(1), receiver: '=HYPERLINK("https://example.test")', company: 'Compañía A & B <campo>', observations: 'Nota extensa '.repeat(20) };
    const { sheet } = await generate([row]);
    expect(sheet.getCell('K5').value).toBe(row.receiver);
    expect(sheet.getCell('M5').value).toBe(row.company);
    expect(sheet.getCell('N5').value).toBe(row.observations);
    expect(sheet.getCell('N5').alignment.wrapText).toBe(true);
    expect(sheet.getCell('K5').alignment.wrapText).toBe(true);
    expect(sheet.getRow(5).height).toBeGreaterThan(30);
    expect(sheet.getColumn('N').width).toBe(33);
  });
  it('no confunde una observación literal Entrada con el tipo de salida para los totales', async () => {
    const { sheet } = await generate([{ ...input(1), observations: 'Entrada' }]);
    expect(sheet.getCell('N26').value).toMatchObject({ result: 1.125 });
    expect(sheet.getCell('N26').formula).toContain('+SUM(E5)');
  });
  it('la ruta de exportación de combustible utiliza el archivo original servido, sin hojas genéricas', async () => {
    const template = await readFile(templatePath);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => template });
    vi.stubGlobal('fetch', fetchMock);
    const payload = crearReporteMovimientos({ moduleName: 'Combustible', movimientos: [], usuarios: {}, periodLabel: '', exportDate: '', generatedBy: '', coverageLabel: '' });
    payload.fuelDeliveryRows = [input(1)];
    const result = await generarReporteMovimientosExcelWeb(payload);
    expect(fetchMock).toHaveBeenCalledWith(FUEL_TEMPLATE_URL);
    const zip = await JSZip.loadAsync(result);
    expect(await zip.file('xl/workbook.xml')!.async('string')).not.toContain('Movimientos generales');
  });
  it('un filtro sin ACPM/gasolina o una plantilla indisponible no produce un Excel falso', async () => {
    expect(createFuelDeliveryRows([], {})).toEqual([]);
    await expect(fillFuelTemplate(await readFile(templatePath), [])).rejects.toThrow('No hay entradas');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const payload = crearReporteMovimientos({ moduleName: 'Combustible', movimientos: [], usuarios: {}, periodLabel: '', exportDate: '', generatedBy: '', coverageLabel: '' });
    payload.fuelDeliveryRows = [input(1)];
    await expect(generarReporteMovimientosExcelWeb(payload)).rejects.toThrow('descargar el formato');
  });
});
