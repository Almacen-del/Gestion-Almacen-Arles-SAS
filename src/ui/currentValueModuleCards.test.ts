import { describe, expect, it } from 'vitest';
import {
  isAseoHistoricoModule,
  isHistoricalInventoryModule,
  isInventoryValuationModuleIncluded,
} from '../valuation/inventoryValuationScope';
import { shouldShowCurrentValueModuleCard } from './currentValueModuleCards';

describe('shouldShowCurrentValueModuleCard', () => {
  it.each([
    'TALLER',
    ' taller ',
    '\tTaLlEr\n',
    'ASEO HISTÓRICO',
    'aseo historico',
    '  ASEO   HISTÓRICO  ',
    'ASEO HISTO\u0301RICO',
    'CONSUMIBLES HISTÓRICO',
    ' consumibles historico ',
    '  Consumibles   Histo\u0301rico  ',
  ])('oculta la tarjeta normalizada %j', (moduleName) => {
    expect(shouldShowCurrentValueModuleCard(moduleName)).toBe(false);
  });

  it.each([
    'ASEO',
    'Consumibles',
    'Consumibles históricos archivo',
    'Lubricantes taller',
    'Taller mecánico',
    'ASEO HISTORICO ARCHIVO',
    'EPP',
  ])('conserva visible el módulo distinto %j', (moduleName) => {
    expect(shouldShowCurrentValueModuleCard(moduleName)).toBe(true);
  });

  it('identifica solo ASEO histórico para sanear registros antiguos del caché', () => {
    expect(isAseoHistoricoModule('  aseo   histórico ')).toBe(true);
    expect(isAseoHistoricoModule('ASEO')).toBe(false);
    expect(isAseoHistoricoModule('ASEO HISTORICO ARCHIVO')).toBe(false);
    expect(isAseoHistoricoModule('TALLER')).toBe(false);
  });

  it('identifica los documentos históricos que no representan productos activos', () => {
    expect(isHistoricalInventoryModule('ASEO HISTÓRICO')).toBe(true);
    expect(isHistoricalInventoryModule('Consumibles historico')).toBe(true);
    expect(isHistoricalInventoryModule('Consumibles')).toBe(false);
    expect(isHistoricalInventoryModule('Lubricantes taller')).toBe(false);
  });

  it('excluye filas, conteos y valor de los módulos fuera del alcance sin mutar la fuente', () => {
    const rows = [
      { moduleName: 'Consumibles', total: 400_000 },
      { moduleName: 'TALLER', total: 300_000 },
      { moduleName: 'ASEO HISTÓRICO', total: 200_000 },
      { moduleName: 'Consumibles historico', total: 50_000 },
      { moduleName: 'Lubricantes taller', total: 150_000 },
      { moduleName: 'EPP', total: 100_000 },
    ];
    const originalRows = structuredClone(rows);

    const valuationRows = rows.filter((entry) => (
      isInventoryValuationModuleIncluded(entry.moduleName)
    ));

    expect(valuationRows.map((entry) => entry.moduleName)).toEqual([
      'Consumibles',
      'Lubricantes taller',
      'EPP',
    ]);
    expect(valuationRows.reduce((sum, entry) => sum + entry.total, 0)).toBe(650_000);
    expect(rows).toEqual(originalRows);
  });
});
