import { describe, expect, it } from 'vitest';
import { calculateEstimatedExitExpense } from './exitExpense';
import type { CurrentValuationRow } from './models';
import { buildMonthlyActivity, destinationLotOf, formatDestinationLot, FUEL_ROUTE_DESTINATION, groupMonthlyExpenses, recoverMonthlyDestinations, summarizeMonthlyActivity, type MonthlyActivitySource } from './monthlyActivity';

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
  it('lleva lavado de tractor, mantenimiento y recogida de personal de combustible al COP', () => {
    for (const labor of ['Lavado de tractor', 'Lavar tractor', 'Lavado del tractor', 'Mantenimiento', 'Mantenimiento moto oasis', 'Mantenimiento camioneta', 'mantenimiento tractor 3', 'Recogida personal', 'Recogida de personal', 'Recogida del personal']) {
      expect(destinationLotOf(placeMovement('cop-trabajo', { labor }))).toBe('COP (Centro de Operaciones)');
    }
    for (const labor of ['Sin mantenimiento', 'No recogida de personal']) {
      expect(destinationLotOf(placeMovement('no', { labor }))).toBe('Sin lote de destino');
    }
    expect(destinationLotOf(placeMovement('otro', { module: 'ASEO', labor: 'Mantenimiento' }))).toBe('Sin lote de destino');
    expect(destinationLotOf(placeMovement('otro-personal', { module: 'ASEO', labor: 'Recogida de personal' }))).toBe('Sin lote de destino');
    const source = placeMovement('cop-trabajo', { labor: 'Mantenimiento camioneta' });
    const current = buildMonthlyActivity('2026-08', [], [source], monthlyCutoff);
    const saved = { ...current, rows: current.rows.map(row => ({ ...row, destinationLot: 'Taller' })) };
    const corrected = recoverMonthlyDestinations(saved, [source]);
    expect(corrected.snapshot.rows[0].destinationLot).toBe('COP (Centro de Operaciones)');
    expect(saved.rows[0].destinationLot).toBe('Taller');
    expect(corrected.snapshot.rows[0].expense).toBe(saved.rows[0].expense);
  });

  it('refleja la corrección confirmada de Roto speed del 19 de agosto sin reescribir el corte', () => {
    const source = placeMovement('1TP0IxcXpmaG0OmKAUT1', { occurredAt: '2026-08-19 13:17', labor: 'Roto speed Lote 3', machinery: 'tractor 3' });
    const current = buildMonthlyActivity('2026-08', [], [source], monthlyCutoff);
    const saved = { ...current, rows: current.rows.map(row => ({ ...row, destinationLot: '17' })) };
    const result = recoverMonthlyDestinations(saved, [source]);
    expect(result.snapshot.rows[0].destinationLot).toBe('3');
    expect(saved.rows[0].destinationLot).toBe('17');
    expect(recoverMonthlyDestinations(saved, []).snapshot.rows[0].destinationLot).toBe('17');
    expect(result.snapshot.rows[0].expense).toBe(saved.rows[0].expense);
  });

  it('reconoce Jardín clonal y Experimental, incluyendo la variante escrita por el usuario', () => {
    for (const text of ['Jardín clonal', 'Fumigación jardín clonal', 'Lote: Jardin clonal']) {
      expect(destinationLotOf(placeMovement('clonal', { labor: text }))).toBe('Jardín clonal');
    }
    for (const text of ['Plateo mecánico lote Experimental', 'lote exerimental', 'Experimental', 'Destino: Experimental']) {
      expect(destinationLotOf(placeMovement('experimental', { labor: text }))).toBe('Experimental');
    }
    // These tasks really occur in the source data, but do not name a destination.
    for (const labor of ['Roto speed', 'Roto speed lote', 'Moto', 'Gallinaza', 'Plateo mecánico 11']) {
      expect(destinationLotOf(placeMovement('pendiente', { labor, machinery: 'tractor 3' }))).toBe('Sin lote de destino');
    }
  });

  it('clasifica el papel H05-007 como Personal sin convertir todo ASEO en Cocina', () => {
    const paper = monthlyMovement('YS8mYKDpIXX0HNchtRMF', { module: 'ASEO', code: 'H05-007', name: 'Papel higienico triple hoja', quantity: 24, labor: 'Personal COP', observations: 'Ubicación: Piso 5' });
    expect(destinationLotOf(paper)).toBe('Personal');
    expect(destinationLotOf({ ...paper, code: 'H05-008', labor: 'Limpieza aire acondicionado' })).toBe('Sin lote de destino');
    const current = buildMonthlyActivity('2026-08', [], [paper], monthlyCutoff);
    const saved = { ...current, rows: current.rows.map(row => ({ ...row, destinationLot: 'COP (Centro de Operaciones)' })) };
    expect(recoverMonthlyDestinations(saved, []).snapshot.rows[0].destinationLot).toBe('Personal');
    expect(saved.rows[0].destinationLot).toBe('COP (Centro de Operaciones)');
  });

  it('usa títulos breves, orden natural y un solo gasto para salidas compartidas entre lotes', () => {
    expect(formatDestinationLot('Lote 03b - Plateo mecánico')).toBe('Lote 3B');
    expect(formatDestinationLot('COP (Centro de Operaciones)')).toBe('Lote COP');
    expect(formatDestinationLot(FUEL_ROUTE_DESTINATION)).toBe('Lote Plantación');
    expect(formatDestinationLot('Personal')).toBe('Lote Personal');
    const labels = ['10', '2', '1', 'Personal', 'recorrido salida/PLANTACION', 'Sin lote de destino', '03b', '3', '24, 23, 22 y 21', '21, 22, 23 y 24'];
    const raw = buildMonthlyActivity('2026-08', [], labels.map((destinationLot, i) => placeMovement(String(i), { destinationLot })), monthlyCutoff);
    const priced = raw.rows.map(row => ({ ...row, expense: 100 }));
    const grouped = groupMonthlyExpenses(priced, 'lot');
    expect(grouped.map(group => group.label)).toEqual(['Lote 1', 'Lote 2', 'Lote 3', 'Lote 3B', 'Lote 10', 'Lote 21, 22, 23 y 24', 'Lote Personal', 'Lote Plantación', 'Sin lote de destino']);
    expect(grouped.find(group => group.label === 'Lote 21, 22, 23 y 24')).toMatchObject({ expense: 200 });
    expect(grouped.reduce((sum, group) => sum + group.expense, 0)).toBe(1000);
    expect(grouped.reduce((sum, group) => sum + group.rows.length, 0)).toBe(10);
  });

  it('guarda maquinaria y la recupera para cortes antiguos solo desde el mismo movimiento', () => {
    const source = placeMovement('tractor', { labor: 'Lote 17', machinery: ' Tractor 3 ' });
    const current = buildMonthlyActivity('2026-08', [], [source], monthlyCutoff);
    expect(current.rows[0].machinery).toBe('Tractor 3');
    const { machinery: _omitted, ...oldRow } = current.rows[0];
    const saved = { ...current, rows: [oldRow] };
    const result = recoverMonthlyDestinations(saved, [source]);
    expect(result.machineryCount).toBe(1);
    expect(result.snapshot.rows[0]).toEqual({ ...oldRow, machinery: 'Tractor 3' });
    expect(saved.rows[0]).not.toHaveProperty('machinery');
    expect(recoverMonthlyDestinations(current, [{ ...source, machinery: 'Otro equipo' }]).snapshot).toBe(current);
    expect(recoverMonthlyDestinations(saved, [{ ...source, quantity: 100 }]).snapshot).toBe(saved);
    expect(recoverMonthlyDestinations(saved, [source, source]).snapshot).toBe(saved);
  });

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

  it('asigna Personal al cargo Supervisor y a las tres salidas ASEO confirmadas de Pedro Vizcaíno', () => {
    for (const field of ['position', 'labor', 'front', 'observations', 'zone', 'recipientName'] as const) {
      expect(destinationLotOf(placeMovement(`supervisor-${field}`, { [field]: 'Supervisor de campo' }))).toBe('Personal');
    }
    expect(destinationLotOf(placeMovement('no-supervisor', { position: 'Operador' }))).toBe('Sin lote de destino');
    expect(destinationLotOf(placeMovement('entrada-supervisor', { type: 'Entrada', position: 'Supervisor' }))).toBe('Sin lote de destino');

    for (const code of ['H03-001', 'H03-007', 'H03-004']) {
      const exit = monthlyMovement(`pedro-${code}`, {
        module: 'ASEO', code, quantity: 1, occurredAt: '2026-08-10 07:13',
        recipientName: 'Pedro Vizcaíno', observations: 'Ubicación: Piso 3', labor: 'Salida',
      });
      expect(destinationLotOf(exit)).toBe('Personal');
      const saved = buildMonthlyActivity('2026-08', [], [exit], monthlyCutoff);
      const old = { ...saved, rows: saved.rows.map(row => ({ ...row, destinationLot: 'Sin lote de destino' })) };
      expect(recoverMonthlyDestinations(old, []).snapshot.rows[0].destinationLot).toBe('Personal');
    }
    expect(destinationLotOf(monthlyMovement('otro-pedro', {
      module: 'ASEO', code: 'H03-001', quantity: 1, occurredAt: '2026-08-11 07:13', recipientName: 'Pedro Vizcaíno',
    }))).toBe('Sin lote de destino');
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
    expect(groupMonthlyExpenses(corrected.snapshot.rows, 'lot')[0]).toMatchObject({ label: 'Lote Personal', expense: 5000 });
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

  it('lee los lotes escritos en Labor/Frente y lleva todo Recorrido de combustible a Plantación', () => {
    expect(destinationLotOf(placeMovement('11', { labor: 'Plateo mecánico lote 11' }))).toBe('11');
    expect(destinationLotOf(placeMovement('17', { front: 'Roto speed lote 17' }))).toBe('17');
    for (const label of ['Recorridos', ' recorrido ', 'RECORRIDOS.', 'Recorrido plantación', 'Motos recorrido plantación']) {
      expect(destinationLotOf(placeMovement('ruta', { module: 'Combustible', labor: label }))).toBe(FUEL_ROUTE_DESTINATION);
    }
    expect(destinationLotOf(placeMovement('frente', { module: 'Combustible', front: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
    expect(destinationLotOf(placeMovement('explicit', { module: 'Combustible', destinationLot: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
    expect(destinationLotOf(placeMovement('prioridad', { module: 'Combustible', destinationLot: 'Lote 8', labor: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
    expect(destinationLotOf(placeMovement('numerado', { module: 'Combustible', zone: 'Lote 9', labor: 'Recorridos' }))).toBe(FUEL_ROUTE_DESTINATION);
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
      { label: 'Lote Cocina', expense: 5000 }, { label: 'Lote COP', expense: 10000 },
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
    expect(groupMonthlyExpenses(result.snapshot.rows, 'lot')[0]).toMatchObject({ label: 'Lote Plantación', expense: snapshot.rows[0].expense });
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
    expect(byLot[0]).toMatchObject({ label: 'Lote 15', expense: 5_000, unpriced: 1 });
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
    const gloveRow = { ...rows[0], valuationId: 'existencias__guante', code: 'G1', product: 'Guante', unit: 'Par', unitValue: 74_550, moduleName: 'EPP' };
    const snapshot = buildMonthlyActivity('2026-08', [agroRow, gloveRow], [
      monthlyMovement('kg', { module: 'Agroquímicos', quantity: 50, unit: 'KG' }),
      monthlyMovement('incompatible', { module: 'Agroquímicos', unit: 'Unidad' }),
      monthlyMovement('guante', { module: 'EPP', code: 'G1', name: 'Guante', quantity: 1, unit: 'Unidad' }),
    ], monthlyCutoff);
    expect(snapshot.rows.find((row) => row.id === 'kg')).toMatchObject({ quantity: 50, unit: 'KG', priceUnit: 'GRAMO' });
    expect(snapshot.rows.find((row) => row.id === 'kg')?.expense).toBeCloseTo(245_000, 2);
    expect(snapshot.rows.find((row) => row.id === 'incompatible')).toMatchObject({ expense: null, issue: 'Unidad incompatible' });
    expect(snapshot.rows.find((row) => row.id === 'guante')).toMatchObject({ priceUnit: 'Par', expense: 74_550, issue: '' });

    const saved = { ...snapshot, rows: snapshot.rows.map((row) => row.id === 'guante' ? { ...row, expense: null, issue: 'Unidad incompatible' as const } : row) };
    expect(recoverMonthlyDestinations(saved, []).snapshot.rows.find((row) => row.id === 'guante'))
      .toMatchObject({ expense: 74_550, issue: '' });
  });

  it('trata una talla numérica de Dotación como unidad física', () => {
    const shirt = { ...rows[0], valuationId: 'existencias__camisa', moduleName: 'Dotación', code: 'DOT-001', product: 'Camisa', unit: '12', unitValue: 80_000 };
    const snapshot = buildMonthlyActivity('2026-08', [shirt], [
      monthlyMovement('camisa', { module: 'Dotación', code: 'DOT-001', name: 'Camisa', unit: 'Unidad', quantity: 1 }),
    ], monthlyCutoff);
    expect(snapshot.rows[0]).toMatchObject({ priceUnit: '12', expense: 80_000, issue: '' });
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
