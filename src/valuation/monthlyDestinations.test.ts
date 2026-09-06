import { describe, expect, it } from 'vitest';
import { buildMonthlyActivity, groupMonthlyExpenses, recoverMonthlyDestinations, type MonthlyActivitySource } from './monthlyActivity';

const source: MonthlyActivitySource = { id: 'exit-july', module: 'Combustible', type: 'Salida', code: 'ACPM2', name: 'ACPM', reference: '',
  quantity: 10.9, occurredAt: '2026-07-16 13:03', unit: 'Galones', recipientName: 'Yeiler Avilorio', destinationLot: '24', labor: 'Cal lote 24' };
const built = buildMonthlyActivity('2026-07', [], [source], new Date('2026-08-01T04:59:59Z'));
const saved = { ...built, rows: [{ ...built.rows[0], destinationLot: '4', expense: 132980, unitValue: 12000, priceUnit: 'Galones', issue: '' as const }] };

describe('stage 3: classification without rewriting financial history', () => {
  it.each(['24', 'California', '9, 10 y 33', 'COP', 'Vivero'])('replaces a known stale destination using the same verified movement: %s', destinationLot => {
    const original = JSON.stringify(saved);
    const result = recoverMonthlyDestinations(saved, [{ ...source, destinationLot }]);
    expect(result.snapshot.rows[0].destinationLot).toBe(destinationLot === 'COP' ? 'COP (Centro de Operaciones)' : destinationLot);
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
