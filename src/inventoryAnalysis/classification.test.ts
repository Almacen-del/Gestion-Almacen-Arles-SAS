import { describe, expect, it } from 'vitest';
import { classifyInventoryAnalysis, DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS } from './classification';
import { loadInventoryAnalysisThresholds, saveInventoryAnalysisThresholds } from './settings';
import type { InventoryPeriodAnalysis } from './models';

function analysis(overrides: Partial<InventoryPeriodAnalysis> = {}): InventoryPeriodAnalysis {
  return {
    product: {
      id: 'p1',
      code: 'P-1',
      name: 'Producto',
      category: 'Categoría',
      unit: 'Unidad',
      module: 'Consumibles',
    },
    period: { from: '2026-03-01', to: '2026-03-31' },
    openingInventory: 100,
    entries: 0,
    exits: 10,
    otherChanges: 0,
    closingInventory: 90,
    averageInventory: 95,
    turnover: 10 / 95,
    lastEntryDate: null,
    lastExitDate: '2026-03-20',
    daysWithoutMovement: 11,
    quality: 'exact',
    issues: [],
    evidence: {
      openingAnchorMovementIds: ['m1'],
      entryMovementIds: [],
      exitMovementIds: ['m1'],
      otherMovementIds: [],
      lastEntryMovementId: null,
      lastExitMovementId: 'm1',
    },
    ...overrides,
  };
}

describe('clasificación configurable del inventario', () => {
  it('mantiene normal un producto que no supera los límites', () => {
    expect(classifyInventoryAnalysis(analysis()).status).toBe('normal');
  });

  it('clasifica baja rotación usando límites modificables', () => {
    const result = classifyInventoryAnalysis(analysis({ turnover: 0.1, daysWithoutMovement: 35 }), {
      lowTurnoverMaximum: 0.15,
      lowTurnoverAfterDays: 30,
    });
    expect(result.status).toBe('low-turnover');
  });

  it('clasifica sin movimiento sin convertirlo automáticamente en obsoleto', () => {
    const result = classifyInventoryAnalysis(analysis({ daysWithoutMovement: 100 }), {
      noMovementAfterDays: 90,
      possibleObsolescenceAfterDays: 180,
    });
    expect(result.status).toBe('no-movement');
  });

  it('marca posible obsolescencia al superar el límite, no obsolescencia confirmada', () => {
    const result = classifyInventoryAnalysis(analysis({ daysWithoutMovement: 181 }));
    expect(result.status).toBe('possible-obsolescence');
  });

  it('solo usa obsoleto confirmado cuando existe confirmación manual', () => {
    const current = analysis();
    current.product = { ...current.product, confirmedObsolete: true };
    expect(classifyInventoryAnalysis(current).status).toBe('confirmed-obsolete');
  });

  it('manda a revisión los resultados históricos insuficientes', () => {
    expect(classifyInventoryAnalysis(analysis({ quality: 'insufficient' })).status).toBe('review');
  });

  it('detecta vencimiento sin asignar obsolescencia confirmada', () => {
    const current = analysis();
    current.product = { ...current.product, expirationDate: '2026-03-01' };
    const result = classifyInventoryAnalysis(current);
    expect(result).toMatchObject({ status: 'possible-obsolescence', expired: true });
  });

  it('detecta próximo vencimiento y conserva la clasificación normal', () => {
    const current = analysis();
    current.product = { ...current.product, expirationDate: '2026-04-15' };
    const result = classifyInventoryAnalysis(current, { nearExpiryDays: 20 });
    expect(result).toMatchObject({ status: 'normal', nearExpiry: true, expired: false });
  });

  it('no alerta por vencimiento cuando ya no existe stock al cierre', () => {
    const current = analysis({ openingInventory: 10, exits: 10, closingInventory: 0, averageInventory: 5 });
    current.product = { ...current.product, expirationDate: '2026-03-01' };
    const result = classifyInventoryAnalysis(current);
    expect(result).toMatchObject({ status: 'review', expired: false });
  });

  it('permite cambiar límites sin modificar código y recuperarlos del almacenamiento', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveInventoryAnalysisThresholds(storage, { noMovementAfterDays: 45 });
    expect(loadInventoryAnalysisThresholds(storage)).toEqual({
      ...DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS,
      noMovementAfterDays: 45,
    });
  });
});
