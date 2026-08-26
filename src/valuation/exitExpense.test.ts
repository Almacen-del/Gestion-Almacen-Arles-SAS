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

function placeMovement(id: string, overrides: Partial<MonthlyActivitySource> = {}) {
  return monthlyMovement(id, { module: 'Combustible', ...overrides });
}

describe('actividad y desglose del gasto mensual', () => {
  it('aplica la confirmación Personal solo a la salida específica de ASEO verificada', () => {
    const confirmed = monthlyMovement('L3chGysCdni8a44RLDZr', {
      module: 'ASEO', code: 'H04-004', name: 'Bolsa de basura negra 65x100 cm', quantity: 1,
      occurredAt: '2026-08-01 06:37', observations: 'Ubicacion: Piso 4', labor: 'Salida', recipientName: 'Dennis bastidas',
    });
    expect(destinationLotOf(confirmed)).toBe('Personal');
    for (const override of [{ id: 'otra-salida' }, { type: 'Entrada' }, { quantity: 2 }, { occurredAt: '2026-08-02 06:37' }, { code: 'H04-003' }]) {
      expect(destinationLotOf({ ...confirmed, ...override })).toBe('Sin lote de destino');
    }
    const current = buildMonthlyActivity('2026-08', [], [confirmed], monthlyCutoff);
    const saved = { ...current, rows: [{ ...current.rows[0], destinationLot: 'Piso 4' }] };
    const corrected = recoverMonthlyDestinations(saved, []);
    expect(corrected.personalCount).toBe(1);
    expect(corrected.snapshot.rows[0]).toEqual({ ...saved.rows[0], destinationLot: 'Personal' });
    expect(saved.rows[0].destinationLot).toBe('Piso 4');
  });

  it('asigna Personal a todas las salidas de Consumibles, Dotación y EPP sin modificar el destinatario', () => {
    for (const module of ['Consumibles', 'CONSUMIBLES', 'Dotación', 'dotacion', 'EPP']) {
      for (const type of ['Salida', 'Entrega', 'Consumo']) {
        expect(destinationLotOf(monthlyMovement('personal', { module, type, destinationLot: 'Lote 11', labor: 'Cocina' }))).toBe('Personal');
      }
      expect(destinationLotOf(monthlyMovement('entrada', { module, type: 'Entrada', destinationLot: 'Lote 11' }))).toBe('11');
    }
    const source = monthlyMovement('personal', { recipientId: 'p-1', recipientName: 'Persona de prueba' });
    const current = buildMonthlyActivity('2026-08', rows, [source], monthlyCutoff);
    expect(current.rows[0]).toMatchObject({ destinationLot: 'Personal', recipientId: 'p-1', recipientName: 'Persona de prueba', expense: 5000 });
    const saved = { ...current, rows: [{ ...current.rows[0], destinationLot: 'Taller' }] };
    const before = JSON.stringify(saved);
    const corrected = recoverMonthlyDestinations(saved, []);
    expect(corrected.personalCount).toBe(1);
    expect(corrected.snapshot.rows[0]).toEqual({ ...saved.rows[0], destinationLot: 'Personal' });
    expect(JSON.stringify(saved)).toBe(before);
    expect(groupMonthlyExpenses(corrected.snapshot.rows, 'lot')[0]).toMatchObject({ label: 'Personal', expense: 5000 });
    expect(recoverMonthlyDestinations(corrected.snapshot, []).personalCount).toBe(0);
    const entry = { ...saved, rows: [{ ...saved.rows[0], kind: 'entry' as const }] };
    expect(recoverMonthlyDestinations(entry, []).snapshot).toBe(entry);
  });

  it('no usa el piso de almacenamiento de ASEO como destino ni lo deduce por destinatario', () => {
    for (const floor of ['Piso 0', 'Piso 00', 'Piso 4', 'PISO 04']) {
      const source = monthlyMovement('aseo', { module: 'ASEO', observations: `Ubicación: ${floor}`, reference: floor });
      expect(destinationLotOf({ ...source, labor: 'Cocina' })).toBe('Cocina');
      expect(destinationLotOf({ ...source, labor: 'Salida', recipientName: 'Dennis bastidas' })).toBe('Sin lote de destino');
      expect(destinationLotOf({ ...source, labor: 'Salida', recipientName: 'Elena Quevedo' })).toBe('Sin lote de destino');
      expect(destinationLotOf({ ...source, destinationLot: floor, labor: 'Cocina' })).toBe('Cocina');
    }
    expect(destinationLotOf(placeMovement('etiquetas', { module: 'ASEO', observations: 'Ubicacion: Piso 4; Destino: Portería' }))).toBe('Portería');
    expect(destinationLotOf(placeMovement('destino-real', { module: 'ASEO', observations: 'Ubicacion: Piso 0', destinationLot: 'Comedor', labor: 'Cocina' }))).toBe('Comedor');
    expect(destinationLotOf(placeMovement('otro-modulo', { module: 'Combustible', destinationLot: 'Piso 4' }))).toBe('Piso 4');
  });

  it('corrige pisos en cortes anteriores sin reescribirlos, alterar totales ni inventar el destino faltante', () => {
    const aseoRows = [{ ...rows[0], moduleName: 'ASEO' }];
    const sources = [
      monthlyMovement('cocina', { module: 'ASEO', observations: 'Ubicacion: Piso 0', labor: 'Cocina' }),
      monthlyMovement('otro-destino', { module: 'ASEO', observations: 'Ubicacion: Piso 4', labor: 'Salida' }),
    ];
    const generated = buildMonthlyActivity('2026-08', aseoRows, sources, monthlyCutoff);
    const saved = { ...generated, rows: generated.rows.map((row) => ({ ...row, destinationLot: row.id === 'cocina' ? 'Piso 0' : 'Piso 4' })) };
    const before = JSON.stringify(saved);
    const result = recoverMonthlyDestinations(saved, sources);
    expect(result.recoveredCount).toBe(1);
    expect(result.discardedStorageCount).toBe(2);
    expect(result.snapshot.rows.find((row) => row.id === 'cocina')?.destinationLot).toBe('Cocina');
    expect(result.snapshot.rows.find((row) => row.id === 'otro-destino')?.destinationLot).toBe('Sin lote de destino');
    expect(JSON.stringify(saved)).toBe(before);
    expect(summarizeMonthlyActivity(result.snapshot.rows).estimatedExpense).toBe(summarizeMonthlyActivity(saved.rows).estimatedExpense);
    for (const row of result.snapshot.rows) expect(row).toEqual({ ...saved.rows.find((original) => original.id === row.id), destinationLot: row.destinationLot });
    const withoutSources = recoverMonthlyDestinations(saved, []);
    expect(withoutSources.recoveredCount).toBe(0);
    expect(withoutSources.discardedStorageCount).toBe(2);
    expect(withoutSources.snapshot.rows.every((row) => row.destinationLot === 'Sin lote de destino')).toBe(true);
    expect(groupMonthlyExpenses(result.snapshot.rows, 'lot').some((group) => group.label.startsWith('Piso'))).toBe(false);
  });

  it('lee los lotes escritos en Labor/Frente y reconoce Recorridos de combustible', () => {
    expect(destinationLotOf(placeMovement('11', { labor: 'Plateo mecánico lote 11' }))).toBe('11');
    expect(destinationLotOf(placeMovement('17', { front: 'Roto speed lote 17' }))).toBe('17');
    for (const label of ['Recorridos', ' recorrido ', 'RECORRIDOS.']) {
      expect(destinationLotOf(placeMovement('ruta', { module: 'Combustible', labor: label }))).toBe(FUEL_ROUTE_DESTINATION);
    }
    expect(destinationLotOf(placeMovement('frente', { module: 'Combustible', front: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
    expect(destinationLotOf(placeMovement('explicit', { module: 'Combustible', destinationLot: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
    expect(destinationLotOf(placeMovement('prioridad', { module: 'Combustible', destinationLot: 'Lote 8', labor: 'Recorridos' }))).toBe('8');
    expect(destinationLotOf(placeMovement('numerado', { module: 'Combustible', zone: 'Lote 9', labor: 'Recorridos' }))).toBe('9');
    expect(destinationLotOf(placeMovement('otro', { module: 'Agroquimicos', labor: 'Recorridos' }))).toBe('Sin lote de destino');
    expect(destinationLotOf(placeMovement('dudoso', { module: 'Combustible', labor: 'Sin recorridos', front: 'Energía' }))).toBe('Sin lote de destino');
  });

  it('reconoce lugares en Labor/Frente, zona y notas y unifica las variantes de COP', () => {
    const cases = [
      ['Energía COP', 'COP (Centro de Operaciones)'], ['centro de operaciones', 'COP (Centro de Operaciones)'],
      ['COP (Centro de Operaciones)', 'COP (Centro de Operaciones)'], ['Energía C.O.P.', 'COP (Centro de Operaciones)'],
      ['Trabajo en taller', 'Taller'], ['COCINA', 'Cocina'], ['Limpieza comedor', 'Comedor'],
      ['Destino: Bodega norte; Responsable: Luis', 'Bodega norte'], ['Lugar: Vivero principal', 'Vivero principal'],
      ['Ubicación: Portería', 'Portería'], ['Zona: Campamento', 'Campamento'], ['Lote: Las Palmas', 'Las Palmas'],
    ];
    for (const [text, expected] of cases) {
      for (const field of ['labor', 'front', 'zone', 'observations'] as const) {
        expect(destinationLotOf(placeMovement('lugar', { [field]: text }))).toBe(expected);
      }
    }
    expect(destinationLotOf(placeMovement('directo', { destinationLot: 'COP', labor: 'Cocina' }))).toBe('COP (Centro de Operaciones)');
    expect(destinationLotOf(placeMovement('numerado', { labor: 'Energía COP', zone: 'Lote 17' }))).toBe('17');
    expect(destinationLotOf(placeMovement('preciso', { observations: 'Destino: Taller 2', labor: 'Taller' }))).toBe('Taller 2');
  });

  it('no convierte labores genéricas, importes, negaciones ni destinos ambiguos en lugares', () => {
    for (const text of ['Plateo mecánico', 'Energía', '20.000 COP', 'COP 20000', 'Sin cocina', 'Transporte desde taller', 'taller y cocina', 'Taller 2', 'Taller 2 y cocina', 'copias']) {
      expect(destinationLotOf(placeMovement('no-lugar', { labor: text }))).toBe('Sin lote de destino');
    }
    expect(destinationLotOf(placeMovement('ambiguo', { labor: 'Taller', front: 'Comedor' }))).toBe('Sin lote de destino');
  });

  it('agrupa COP y Centro de Operaciones juntos y recupera lugares sin modificar el corte', () => {
    const sources = [placeMovement('cop'), placeMovement('centro'), placeMovement('cocina')];
    const original = buildMonthlyActivity('2026-08', rows.map((row) => ({ ...row, moduleName: 'Combustible' })), sources, monthlyCutoff);
    const recovered = recoverMonthlyDestinations(original, sources.map((source, index) => ({ ...source, labor: ['Energía COP', 'Centro de Operaciones', 'Cocina'][index] })));
    expect(recovered.recoveredCount).toBe(3);
    expect(groupMonthlyExpenses(recovered.snapshot.rows, 'lot').map(({ label, expense }) => ({ label, expense }))).toEqual([
      { label: 'COP (Centro de Operaciones)', expense: 10000 }, { label: 'Cocina', expense: 5000 },
    ]);
    expect(original.rows.every((row) => row.destinationLot === 'Sin lote de destino')).toBe(true);
    expect(summarizeMonthlyActivity(recovered.snapshot.rows).estimatedExpense).toBe(summarizeMonthlyActivity(original.rows).estimatedExpense);
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
    const snapshot = buildMonthlyActivity('2026-08', rows.map((row) => ({ ...row, moduleName: 'Combustible' })), [
      placeMovement('valorada', { observations: 'Lote: 15; Responsable: Luis' }),
      placeMovement('sin-precio', { code: 'P2', name: 'Producto dos', destinationLot: 'Lote 15' }),
      placeMovement('no-identificada', { code: '?', name: '?' }),
    ], monthlyCutoff);
    expect(summarizeMonthlyActivity(snapshot.rows)).toMatchObject({ estimatedExpense: 5_000, exitCount: 3, unpricedExitCount: 2 });
    const byLot = groupMonthlyExpenses(snapshot.rows, 'lot');
    expect(byLot[0]).toMatchObject({ label: '15', expense: 5_000, unpriced: 1 });
    for (const grouping of ['lot', 'module', 'product'] as const) {
      expect(groupMonthlyExpenses(snapshot.rows, grouping).reduce((sum, group) => sum + group.expense, 0)).toBe(5_000);
    }
    expect(destinationLotOf(placeMovement('zona', { zone: 'Lote 7' }))).toBe('7');
    expect(destinationLotOf(placeMovement('nota-real', { observations: 'Lote 3 12 de agosto' }))).toBe('3');
    expect(destinationLotOf(placeMovement('varios', { observations: 'Lotes: 1 y 2; entrega' }))).toBe('1 y 2');
    expect(destinationLotOf(placeMovement('sin-lote'))).toBe('Sin lote de destino');
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
