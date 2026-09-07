import { describe, expect, it } from 'vitest';
import { buildMonthlyActivity, destinationLotOf, formatDestinationLot, groupMonthlyExpenses, type MonthlyActivitySource } from './monthlyActivity';

const source: MonthlyActivitySource = { id: 'audit', module: 'Combustible', type: 'Salida', code: 'GAS1', name: 'Gasolina', reference: '', quantity: 1, unit: 'Galones', occurredAt: '2026-09-07', labor: 'Plateo' };
describe('audit A10/A11: preserve explicit and mixed expense destinations', () => {
  it.each(['4 y Vivero', 'Vivero y 04', 'Lote 4 y Lote Vivero', '4, Vivero y 4'])('preserves the whole mixed delivery: %s', destinationLot => {
    expect(destinationLotOf({ ...source, destinationLot })).toBe('4 y Vivero');
    expect(formatDestinationLot(destinationLot)).toBe('Lote 4 y Vivero');
  });
  it('preserves qualified places instead of truncating them', () => {
    expect(destinationLotOf({ ...source, destinationLot: '4 y Vivero principal' })).toBe('4 y Vivero principal');
  });
  it.each([{ labor: 'Recorrido' }, { labor: 'Mantenimiento' }, { machinery: 'Hidrolavadora' }])('does not replace explicit California by a work inference: %j', override => {
    expect(destinationLotOf({ ...source, ...override, destinationLot: 'California' })).toBe('California');
    expect(destinationLotOf({ ...source, ...override, destinationLot: '8' })).toBe('8');
    expect(destinationLotOf({ ...source, ...override, destinationLot: '' })).toBe('Centro Operativo (COP)');
  });
  it('keeps one row and one expense for a joint delivery', () => {
    const snapshot = buildMonthlyActivity('2026-09', [], [{ ...source, destinationLot: '4 y Vivero' }], new Date('2026-10-01T04:59:59Z'));
    const rows = snapshot.rows.map(row => ({ ...row, expense: 17000 }));
    expect(groupMonthlyExpenses(rows, 'lot')).toHaveLength(1);
    expect(groupMonthlyExpenses(rows, 'lot')[0]).toMatchObject({ label: 'Lote 4 y Vivero', expense: 17000 });
  });
});
