import { describe, expect, it } from 'vitest';
import { buildMonthlyActivity, COP_DESTINATION, destinationLotOf, formatDestinationLot, groupMonthlyExpenses, recoverMonthlyDestinations, type MonthlyActivitySource } from './monthlyActivity';

const source: MonthlyActivitySource = { id: 'exit-july', module: 'Combustible', type: 'Salida', code: 'ACPM2', name: 'ACPM', reference: '',
  quantity: 10.9, occurredAt: '2026-07-16 13:03', unit: 'Galones', recipientName: 'Yeiler Avilorio', destinationLot: '24', labor: 'Cal lote 24' };
const built = buildMonthlyActivity('2026-07', [], [source], new Date('2026-08-01T04:59:59Z'));
const saved = { ...built, rows: [{ ...built.rows[0], destinationLot: '4', expense: 132980, unitValue: 12000, priceUnit: 'Galones', issue: '' as const }] };

describe('stage 3: classification without rewriting financial history', () => {
  const copAliases = [
    'COP', 'C.O.P.', 'Centro Operativo', 'Centro Operativo (COP)', 'COP (Centro operativo)',
    'Centro de Operaciones', 'COP (Centro de Operaciones)', 'Centro de Operaciones (COP)',
    'Plantación', ' plantacion ', 'Lote Plantación', 'Recorrido', 'RECORRIDOS', 'Recorrido plantación',
  ];

  it.each(copAliases)('unifies the confirmed COP alias in current rows and historical cuts: %s', destinationLot => {
    expect(destinationLotOf({ ...source, destinationLot })).toBe(COP_DESTINATION);
    expect(formatDestinationLot(destinationLot)).toBe('Lote COP');
    const historical = { ...saved, rows: [{ ...saved.rows[0], destinationLot }] };
    const before = JSON.stringify(historical);
    const result = recoverMonthlyDestinations(historical, []);
    expect(result.snapshot.rows[0]).toEqual({ ...historical.rows[0], destinationLot: COP_DESTINATION });
    expect(JSON.stringify(historical)).toBe(before);
    expect(recoverMonthlyDestinations(result.snapshot, []).snapshot).toBe(result.snapshot);
  });

  it('combines COP aliases into one expense group without duplicating amounts or merging California', () => {
    const historical = { ...saved, rows: [...copAliases, 'California', '24'].map((destinationLot, index) => ({
      ...saved.rows[0], id: `alias-${index}`, destinationLot,
    })) };
    const result = recoverMonthlyDestinations(historical, []);
    const groups = groupMonthlyExpenses(result.snapshot.rows, 'lot');
    expect(groups.map(group => group.label)).toEqual(['Lote 24', 'Lote California', 'Lote COP']);
    const cop = groups.find(group => group.label === 'Lote COP')!;
    expect(cop.rows).toHaveLength(copAliases.length);
    expect(cop.expense).toBe(132980 * copAliases.length);
    expect(groups.reduce((sum, group) => sum + group.expense, 0)).toBe(132980 * historical.rows.length);
    result.snapshot.rows.forEach((row, index) => expect(row).toEqual({ ...historical.rows[index], destinationLot: row.destinationLot }));
  });

  it.each(['labor', 'front', 'zone', 'observations'] as const)('recognizes Plantación and Centro Operativo in %s without changing the original work', field => {
    for (const value of ['Plantación', 'Centro Operativo', 'Centro Operativo (COP)']) {
      const movement = { ...source, destinationLot: '', labor: '', [field]: value };
      const before = JSON.stringify(movement);
      expect(destinationLotOf(movement)).toBe(COP_DESTINATION);
      expect(JSON.stringify(movement)).toBe(before);
    }
    for (const value of ['Sin plantación', 'Origen: plantación', 'Sin recorridos', 'No recorrido']) {
      expect(destinationLotOf({ ...source, destinationLot: '', labor: '', [field]: value })).toBe('Sin lote de destino');
    }
  });

  it.each(['24', 'California', '9, 10 y 33', 'COP', 'Vivero'])('replaces a known stale destination using the same verified movement: %s', destinationLot => {
    const original = JSON.stringify(saved);
    const result = recoverMonthlyDestinations(saved, [{ ...source, destinationLot }]);
    expect(result.snapshot.rows[0].destinationLot).toBe(destinationLot === 'COP' ? 'Centro Operativo (COP)' : destinationLot);
    expect(result.snapshot.rows[0].expense).toBe(132980); // Deliberately differs from qty * current price.
    expect(result.snapshot.rows[0].unitValue).toBe(12000);
    expect(JSON.stringify(saved)).toBe(original);
    expect(result.corrections[0]).toMatchObject({ movementId: source.id, before: '4', after: result.snapshot.rows[0].destinationLot });
    expect(groupMonthlyExpenses(result.snapshot.rows, 'lot').reduce((sum, group) => sum + group.expense, 0)).toBe(132980);
    expect(recoverMonthlyDestinations(result.snapshot, [{ ...source, destinationLot }]).snapshot).toBe(result.snapshot);
  });
  it.each([
    [], [source, source], [{ ...source, quantity: 11 }], [{ ...source, occurredAt: '2026-07-17 13:03' }],
    [{ ...source, code: 'GAS1' }], [{ ...source, unit: 'ML' }], [{ ...source, module: 'ASEO' }],
    [{ ...source, type: 'Entrada' }], [{ ...source, destinationLot: '', labor: 'Cal' }],
  ].map(sources => ({ sources })))('keeps a known destination when the matching evidence is missing or ambiguous (%#)', ({ sources }) => {
    expect(recoverMonthlyDestinations(saved, sources).snapshot).toBe(saved);
  });
  it('recovers an unpriced exit destination without inventing a historical price or expense', () => {
    const unpriced = { ...saved, rows: [{ ...saved.rows[0], issue: 'Unidad incompatible' as const, expense: null }] };
    const result = recoverMonthlyDestinations(unpriced, [source]);
    expect(result.snapshot.rows[0]).toEqual({ ...unpriced.rows[0], destinationLot: '24' });
  });
});
