import { describe, expect, it } from 'vitest';
import { DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS } from './classification';
import { buildProductInventoryInsights, buildWarehouseInventorySummary, type ClassifiedInventoryAnalysis } from './insights';

function row(overrides: Partial<ClassifiedInventoryAnalysis> = {}): ClassifiedInventoryAnalysis {
  return {
    product: { id: 'p', code: 'P-1', name: 'Producto', category: 'Cat', unit: 'Unidad', module: 'Consumibles' },
    period: { from: '2026-08-01', to: '2026-08-18' },
    openingInventory: 10,
    entries: 0,
    exits: 2,
    otherChanges: 0,
    closingInventory: 8,
    averageInventory: 9,
    turnover: 2 / 9,
    lastEntryDate: null,
    lastExitDate: '2026-08-10',
    daysWithoutMovement: 8,
    quality: 'exact',
    issues: [],
    evidence: { openingAnchorMovementIds: [], entryMovementIds: [], exitMovementIds: [], otherMovementIds: [], lastEntryMovementId: null, lastExitMovementId: null },
    classification: { status: 'normal', label: 'Movimiento normal', reasons: [], expired: false, nearExpiry: false },
    ...overrides,
  };
}

describe('análisis automático basado en datos', () => {
  it('describe una disminución comprobable sin inventar causas', () => {
    const history = [row({ exits: 9 }), row({ exits: 6 }), row({ exits: 2 })];
    const insights = buildProductInventoryInsights(row(), history, DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS);
    expect(insights).toContainEqual(expect.objectContaining({ title: 'Disminución de movimiento' }));
    expect(insights.map((entry) => entry.message).join(' ')).not.toMatch(/demanda|proveedor|precio/i);
  });

  it('diferencia posible obsolescencia de una confirmación', () => {
    const current = row({
      classification: { status: 'possible-obsolescence', label: 'Posible obsolescencia', reasons: [], expired: false, nearExpiry: false },
    });
    const insights = buildProductInventoryInsights(current, [], DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS);
    expect(insights.find((entry) => entry.title === 'Posible obsolescencia')?.message).toContain('no se marcó como obsoleto confirmado');
  });

  it('compara conteos contra el período anterior', () => {
    const current = [row(), row({ product: { ...row().product, id: 'p2' }, classification: { status: 'no-movement', label: 'Sin movimiento', reasons: [], expired: false, nearExpiry: false } })];
    const previous = [row()];
    const summary = buildWarehouseInventorySummary(current, previous);
    expect(summary.differences.noMovement).toBe(1);
    expect(summary.differences.normal).toBe(0);
  });
});
