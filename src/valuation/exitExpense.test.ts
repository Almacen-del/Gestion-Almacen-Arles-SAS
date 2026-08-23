import { describe, expect, it } from 'vitest';
import { calculateEstimatedExitExpense } from './exitExpense';
import type { CurrentValuationRow } from './models';

const rows: CurrentValuationRow[] = [{
  valuationId: 'existencias__p1',
  moduleName: 'Consumibles',
  code: 'P1',
  product: 'Producto uno',
  reference: 'N/A',
  quantity: 8,
  unit: 'Unidad',
  unitValue: 2_500,
  totalValue: 20_000,
  includesOccupied: false,
}, {
  valuationId: 'existencias__p2',
  moduleName: 'Consumibles',
  code: 'P2',
  product: 'Producto dos',
  reference: 'N/A',
  quantity: 3,
  unit: 'Unidad',
  unitValue: 0,
  totalValue: 0,
  includesOccupied: false,
}];

const products = rows.map((row, index) => ({
  id: `p${index + 1}`,
  module: row.moduleName,
  code: row.code,
  name: row.product,
  reference: row.reference,
  category: 'General',
  unit: row.unit,
}));

describe('gasto estimado de salidas', () => {
  it('multiplica las salidas identificadas por el valor unitario actual', () => {
    const result = calculateEstimatedExitExpense(rows, products, [{
      id: 'm1', module: 'Consumibles', type: 'Salida', code: 'P1', name: 'Producto uno', reference: 'N/A', quantity: 3, occurredAt: '2026-08-01',
    }, {
      id: 'm2', module: 'Consumibles', type: 'Entrada', code: 'P1', name: 'Producto uno', reference: 'N/A', quantity: 5, occurredAt: '2026-08-02',
    }]);
    expect(result).toEqual({
      estimatedTotal: 7_500,
      exitCount: 1,
      valuedExitCount: 1,
      unvaluedExitCount: 0,
      unresolvedExitCount: 0,
      missingValuations: [],
    });
  });

  it('separa las salidas sin precio y las que no tienen producto identificable', () => {
    const result = calculateEstimatedExitExpense(rows, products, [{
      id: 'm1', module: 'Consumibles', type: 'Entrega', code: 'P2', name: 'Producto dos', reference: 'N/A', quantity: 1, occurredAt: '2026-08-01',
    }, {
      id: 'm2', module: 'Consumibles', type: 'Salida', code: '', name: 'Desconocido', reference: '', quantity: 1, occurredAt: '2026-08-02',
    }]);
    expect(result).toMatchObject({
      estimatedTotal: 0,
      exitCount: 2,
      valuedExitCount: 0,
      unvaluedExitCount: 1,
      unresolvedExitCount: 1,
      missingValuations: [{
        productId: 'existencias__p2',
        code: 'P2',
        product: 'Producto dos',
        moduleName: 'Consumibles',
        exitCount: 1,
      }],
    });
  });
});
