import { describe, expect, it } from 'vitest';
import { calculateEstimatedExitExpense } from './exitExpense';
import type { CurrentValuationRow } from './models';
import { buildMonthlyActivity, destinationLotOf, FUEL_ROUTE_DESTINATION, groupMonthlyExpenses, recoverMonthlyDestinations, summarizeMonthlyActivity, type MonthlyActivitySource } from './monthlyActivity';

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

function monthlyMovement(id: string, overrides: Partial<MonthlyActivitySource> = {}): MonthlyActivitySource {
  return {
    id, module: 'Consumibles', type: 'Salida', code: 'P1', name: 'Producto uno', reference: 'N/A',
    quantity: 2, unit: 'Unidad', occurredAt: '2026-08-10 10:00', ...overrides,
  };
}
const monthlyCutoff = new Date('2026-08-26T18:00:00Z');

describe('actividad y desglose del gasto mensual', () => {
  it('lee los lotes escritos en Labor/Frente y reconoce Recorridos de combustible', () => {
    expect(destinationLotOf(monthlyMovement('11', { labor: 'Plateo mecánico lote 11' }))).toBe('11');
    expect(destinationLotOf(monthlyMovement('17', { front: 'Roto speed lote 17' }))).toBe('17');
    for (const label of ['Recorridos', ' recorrido ', 'RECORRIDOS.']) {
      expect(destinationLotOf(monthlyMovement('ruta', { module: 'Combustible', labor: label }))).toBe(FUEL_ROUTE_DESTINATION);
    }
    expect(destinationLotOf(monthlyMovement('frente', { module: 'Combustible', front: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
    expect(destinationLotOf(monthlyMovement('explicit', { module: 'Combustible', destinationLot: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
    expect(destinationLotOf(monthlyMovement('prioridad', { module: 'Combustible', destinationLot: 'Lote 8', labor: 'Recorridos' }))).toBe('8');
    expect(destinationLotOf(monthlyMovement('numerado', { module: 'Combustible', zone: 'Lote 9', labor: 'Recorridos' }))).toBe('9');
    expect(destinationLotOf(monthlyMovement('otro', { module: 'EPP', labor: 'Recorridos' }))).toBe('Sin lote de destino');
    expect(destinationLotOf(monthlyMovement('dudoso', { module: 'Combustible', labor: 'Sin recorridos', front: 'Energía COP' }))).toBe('Sin lote de destino');
  });

  it('recupera el destino de cortes antiguos sin alterar importes, destinos conocidos ni originales', () => {
    const fuelRows = [{ ...rows[0], moduleName: 'Combustible' }];
    const source = monthlyMovement('ruta', { module: 'Combustible' });
    const snapshot = buildMonthlyActivity('2026-08', fuelRows, [source], monthlyCutoff);
    const before = JSON.stringify(snapshot);
    const result = recoverMonthlyDestinations(snapshot, [{ ...source, labor: 'Recorridos' }]);
    expect(result.recoveredCount).toBe(1);
    expect(result.snapshot.rows[0].destinationLot).toBe(FUEL_ROUTE_DESTINATION);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(result.snapshot.rows[0]).toEqual({ ...snapshot.rows[0], destinationLot: FUEL_ROUTE_DESTINATION });
    expect(groupMonthlyExpenses(result.snapshot.rows, 'lot')[0]).toMatchObject({ label: FUEL_ROUTE_DESTINATION, expense: snapshot.rows[0].expense });
    expect(recoverMonthlyDestinations(result.snapshot, [{ ...source, labor: 'Lote 25' }]).recoveredCount).toBe(0);
    expect(recoverMonthlyDestinations(snapshot, []).recoveredCount).toBe(0);
    expect(recoverMonthlyDestinations(snapshot, [{ ...source, labor: 'Recorridos', quantity: 500 }]).recoveredCount).toBe(0);
    expect(recoverMonthlyDestinations(snapshot, [{ ...source, labor: 'Recorridos' }, { ...source, labor: 'Lote 20' }]).recoveredCount).toBe(0);
  });

  it('respeta el mes de Bogotá y el corte, deduplica y excluye Taller, ajustes y cantidades inválidas', () => {
    const snapshot = buildMonthlyActivity('2026-08', rows, [
      monthlyMovement('salida'), monthlyMovement('salida'),
      monthlyMovement('entrada', { type: 'Entrada', quantity: 3 }),
      monthlyMovement('julio', { occurredAt: '2026-08-01T04:59:00Z' }),
      monthlyMovement('agosto', { occurredAt: '2026-08-01T05:00:00Z' }),
      monthlyMovement('posterior', { occurredAt: '2026-08-26T18:01:00Z' }),
      monthlyMovement('taller', { module: 'TALLER' }), monthlyMovement('ajuste', { type: 'Ajuste' }),
      monthlyMovement('cero', { quantity: 0 }), monthlyMovement('negativo', { quantity: -2 }),
      monthlyMovement('sin-fecha', { occurredAt: '' }),
    ], monthlyCutoff);
    expect(snapshot.rows.map((row) => row.id).sort()).toEqual(['agosto', 'entrada', 'salida']);
    expect(snapshot.invalidDateCount).toBe(1);
    expect(snapshot.invalidQuantityCount).toBe(2);
    expect(summarizeMonthlyActivity(snapshot.rows)).toMatchObject({ entryCount: 1, exitCount: 2, estimatedExpense: 10_000 });
  });

  it('usa el precio del corte y conserva salidas no identificadas o sin precio sin inventar valores', () => {
    const snapshot = buildMonthlyActivity('2026-08', rows, [
      monthlyMovement('valorada', { observations: 'Lote: 15; Responsable: Luis' }),
      monthlyMovement('sin-precio', { code: 'P2', name: 'Producto dos', destinationLot: 'Lote 15' }),
      monthlyMovement('no-identificada', { code: '?', name: '?' }),
    ], monthlyCutoff);
    expect(summarizeMonthlyActivity(snapshot.rows)).toMatchObject({ estimatedExpense: 5_000, exitCount: 3, unpricedExitCount: 2 });
    const byLot = groupMonthlyExpenses(snapshot.rows, 'lot');
    expect(byLot[0]).toMatchObject({ label: '15', expense: 5_000, unpriced: 1 });
    for (const grouping of ['lot', 'module', 'product'] as const) {
      expect(groupMonthlyExpenses(snapshot.rows, grouping).reduce((sum, group) => sum + group.expense, 0)).toBe(5_000);
    }
    expect(destinationLotOf(monthlyMovement('zona', { zone: 'Lote 7' }))).toBe('7');
    expect(destinationLotOf(monthlyMovement('nota-real', { observations: 'Lote 3 12 de agosto' }))).toBe('3');
    expect(destinationLotOf(monthlyMovement('varios', { observations: 'Lotes: 1 y 2; entrega' }))).toBe('1 y 2');
    expect(destinationLotOf(monthlyMovement('sin-lote'))).toBe('Sin lote de destino');
  });

  it('convierte unidades compatibles para valorar, sin mezclar cantidades ni cobrar una unidad incompatible', () => {
    const agroRow = { ...rows[0], unit: 'GRAMO', unitValue: 4.9, moduleName: 'Agroquímicos' };
    const snapshot = buildMonthlyActivity('2026-08', [agroRow], [
      monthlyMovement('kg', { module: 'Agroquímicos', quantity: 50, unit: 'KG' }),
      monthlyMovement('incompatible', { module: 'Agroquímicos', unit: 'Unidad' }),
    ], monthlyCutoff);
    expect(snapshot.rows.find((row) => row.id === 'kg')).toMatchObject({ quantity: 50, unit: 'KG', priceUnit: 'GRAMO' });
    expect(snapshot.rows.find((row) => row.id === 'kg')?.expense).toBeCloseTo(245_000, 2);
    expect(snapshot.rows.find((row) => row.id === 'incompatible')).toMatchObject({ expense: null, issue: 'Unidad incompatible' });
  });

  it('agrupa Dotación y EPP por destinatario con sus productos, sin incluir otros módulos', () => {
    const personalRows = [{ ...rows[0], moduleName: 'EPP' }, { ...rows[1], moduleName: 'Dotación', unitValue: 1000 }];
    const snapshot = buildMonthlyActivity('2026-08', personalRows, [
      monthlyMovement('epp', { module: 'EPP', recipientId: ' Luis Pérez ', recipientName: 'Luis Pérez' }),
      monthlyMovement('dotacion', { module: 'Dotación', code: 'P2', name: 'Producto dos', recipientId: 'luis pérez', recipientName: 'Luis Pérez' }),
      monthlyMovement('sin-persona', { module: 'EPP' }),
      monthlyMovement('otro-modulo'),
      monthlyMovement('entrada', { module: 'EPP', type: 'Entrada', recipientId: 'Luis Pérez' }),
    ], monthlyCutoff);
    const groups = groupMonthlyExpenses(snapshot.rows, 'person');
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.label === 'Luis Pérez')).toMatchObject({ expense: 7_000 });
    expect(groups.find((group) => group.label === 'Luis Pérez')?.rows.map((row) => row.moduleName).sort()).toEqual(['Dotación', 'EPP']);
    expect(groups.find((group) => group.label === 'Sin personal identificado')).toMatchObject({ expense: 5_000 });
  });
});
