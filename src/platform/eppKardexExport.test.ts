import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { FilaMovimientoExcel } from '../reporteMovimientosExcel';
import { fillEppKardexTemplate } from './eppKardexExport';

const templatePath = 'public/templates/KARDEX-EPP.xlsx';
function row(overrides: Partial<FilaMovimientoExcel> = {}): FilaMovimientoExcel {
  return {
    cantidad: 2, fecha_ingreso: '', fecha_salida: '', lotes: [], fecha: '2026-08-03', tipo_movimiento: 'Salida',
    codigo: 'PC01', nombre_producto: 'CANILLERA CORTA', submodulo: 'EPP', subcategoria: '', cantidad_entrada: 0,
    cantidad_salida: 2, unidad: 'Par', saldo_anterior: 0, saldo_nuevo: 0, estado_conciliacion: 'Conciliado',
    responsable: 'Felipe Estrada', observacion: '', documento_soporte: '', labor: '', zona: '', horometro: '',
    ...overrides,
  };
}

async function generate(entradas: FilaMovimientoExcel[], salidas: FilaMovimientoExcel[]) {
  const original = await readFile(templatePath);
  const bytes = await fillEppKardexTemplate(original, entradas, salidas);
  return { original, bytes };
}

describe('Kardex EPP sobre formato existente', () => {
  it('conserva el histórico y añade R.E/R.S después de la última fecha registrada', async () => {
    const entry = row({ fecha: '2026-08-01', tipo_movimiento: 'Entrada', codigo: 'PC04', nombre_producto: 'DELANTAL DE CARNAZA T UNICA', unidad: 'Unidad', cantidad: 4, cantidad_entrada: 4, cantidad_salida: 0, responsable: '' });
    const exit = row({ fecha: '2026-08-03', codigo: 'PC01', nombre_producto: 'CANILLERA CORTA', unidad: 'Par', cantidad: 2, cantidad_salida: 2 });
    const { original, bytes } = await generate([entry], [exit]);
    expect(createHash('sha256').update(original).digest('hex')).toBe('4f434c048310f395ac6d07b4c5f88cc06083dd343fc43ef874d5626b948c05cd');
    const before = await JSZip.loadAsync(original), after = await JSZip.loadAsync(bytes);
    expect(await after.file('xl/workbook.xml')!.async('string')).toContain('name="R.S"');
    const rs = await after.file('xl/worksheets/sheet2.xml')!.async('string');
    const re = await after.file('xl/worksheets/sheet3.xml')!.async('string');
    expect(rs).toContain('<x:c r="A746" s="89" t="n"><x:v>46234</x:v>');
    expect(rs).toContain('<x:c r="A747" s="89"><x:v>46237</x:v>');
    expect(rs).toContain('<x:t xml:space="preserve">PC01</x:t>');
    expect(rs).toContain('<x:t xml:space="preserve">Felipe Estrada</x:t>');
    expect(rs).toContain('<x:c r="F747" s="90"><x:v>2</x:v>');
    expect(re).toContain('<x:c r="A107" s="91" t="n"><x:v>46213</x:v>');
    expect(re).toContain('<x:c r="A108" s="91"><x:v>46235</x:v>');
    expect(re).toContain('<x:t xml:space="preserve">DELANTAL DE CARNAZA T UNICA</x:t>');
    expect(re).toContain('<x:c r="E108" s="92"><x:v>4</x:v>');
    expect(await after.file('xl/workbook.xml')!.async('string')).toContain('fullCalcOnLoad="1"');
    const changed = ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/workbook.xml'];
    expect(Object.keys(after.files).filter((key) => !after.files[key].dir).sort()).toEqual(Object.keys(before.files).filter((key) => !before.files[key].dir).sort());
    for (const path of Object.keys(before.files).filter((key) => !before.files[key].dir && !changed.includes(key))) {
      expect(await after.file(path)!.async('uint8array'), path).toEqual(await before.file(path)!.async('uint8array'));
    }
  });

  it('no agrega movimientos ya cubiertos por la última fecha del Kardex', async () => {
    const prior = row({ fecha: '2026-07-31' });
    await expect(generate([], [prior])).rejects.toThrow('No hay movimientos EPP posteriores');
  });

  it('detiene la exportación si un movimiento EPP tiene fecha inválida', async () => {
    await expect(generate([], [row({ fecha: 'Sin fecha' })])).rejects.toThrow('sin fecha válida');
  });

  it('extiende los rangos de cálculo si supera la capacidad visible de la plantilla', async () => {
    const entradas = Array.from({ length: 788 }, () => row({ fecha: '2026-08-01', tipo_movimiento: 'Entrada', cantidad: 1, cantidad_entrada: 1, cantidad_salida: 0 }));
    const salidas = Array.from({ length: 202 }, () => row({ fecha: '2026-08-02', cantidad: 1, cantidad_salida: 1 }));
    const { bytes } = await generate(entradas, salidas);
    const zip = await JSZip.loadAsync(bytes);
    const summary = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(summary).toContain("'R.S'!$B$2:$B$948");
    expect(summary).toContain("'R.S'!$F$2:$F$948");
    expect(summary).toContain("'R.E'!$E$2:$E$895");
    expect(summary).toContain("'R.E'!$B$2:$B$895");
  });
});
