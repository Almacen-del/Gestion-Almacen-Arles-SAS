import { describe, expect, it } from 'vitest';
import type { MonthlyActivitySource } from './monthlyActivity';
import type { CurrentValuationRow } from './models';
import { monthEndBogota, priorPeriods, reconstructHistoricalMonthlyClose } from './historicalReconstruction';

const currentRows: CurrentValuationRow[] = [{
  valuationId: 'existencias__p1', moduleName: 'Consumibles', code: 'P1', product: 'Producto uno', reference: 'N/A',
  quantity: 10, unit: 'Unidad', unitValue: 100, totalValue: 1_000, includesOccupied: false,
}];

function movement(id: string, occurredAt: string, type: 'Entrada' | 'Salida', quantity: number, overrides: Partial<MonthlyActivitySource> = {}): MonthlyActivitySource {
  return { id, occurredAt, type, quantity, module: 'Consumibles', code: 'P1', name: 'Producto uno', reference: 'N/A', unit: 'Unidad', ...overrides };
}

describe('reconstrucción de cierres históricos', () => {
  it('reconstruye junio y julio revirtiendo movimientos posteriores y conserva precios actuales', () => {
    const movements = [
      movement('junio-salida', '2026-06-20 10:00', 'Salida', 1),
      movement('julio-entrada', '2026-07-05 10:00', 'Entrada', 5),
      movement('julio-salida', '2026-07-10 10:00', 'Salida', 2),
      movement('agosto-entrada', '2026-08-05 10:00', 'Entrada', 3),
      movement('agosto-salida', '2026-08-10 10:00', 'Salida', 1),
    ];
    const now = new Date('2026-08-26T18:00:00Z');
    const july = reconstructHistoricalMonthlyClose({ period: '2026-07', currentRows, moduleOptions: ['Consumibles'], movements, now });
    expect(july.rows[0]).toMatchObject({ quantity: 8, unitValue: 100, totalValue: 800 });
    expect(july.activity.rows.map((row) => row.id).sort()).toEqual(['julio-entrada', 'julio-salida']);
    expect(july.reversedMovementCount).toBe(2);
    expect(july.blockingIssues).toEqual([]);

    const june = reconstructHistoricalMonthlyClose({ period: '2026-06', currentRows, moduleOptions: ['Consumibles'], movements, now });
    expect(june.rows[0]).toMatchObject({ quantity: 5, unitValue: 100, totalValue: 500 });
    expect(june.activity.rows).toHaveLength(1);
    expect(june.reversedMovementCount).toBe(4);
  });

  it('bloquea saldos negativos y movimientos posteriores sin producto identificable', () => {
    const result = reconstructHistoricalMonthlyClose({
      period: '2026-07', currentRows: [{ ...currentRows[0], quantity: 0, totalValue: 0 }], moduleOptions: ['Consumibles'],
      movements: [
        movement('entrada', '2026-08-05 10:00', 'Entrada', 4),
        movement('desconocido', '2026-08-06 10:00', 'Salida', 1, { code: '?', name: '?' }),
      ],
      now: new Date('2026-08-26T18:00:00Z'),
    });
    expect(result.rows[0].quantity).toBe(-4);
    expect(result.blockingIssues).toEqual([
      '1 movimiento(s) posterior(es) no tienen producto identificable.',
      '1 producto(s) quedarían con existencia negativa al reconstruir el mes.',
    ]);
    expect(result.blockingDetails).toEqual([
      '2026-08-06 10:00 · ? · ?: producto no identificable.',
      'P1 · Producto uno: existencia reconstruida -4 Unidad.',
    ]);
  });

  it('usa el último instante de Bogotá y calcula los dos períodos anteriores', () => {
    expect(monthEndBogota('2026-07').toISOString()).toBe('2026-08-01T04:59:59.999Z');
    expect(priorPeriods('2026-08', 2)).toEqual(['2026-07', '2026-06']);
  });
});
