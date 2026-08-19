import { describe, expect, it } from 'vitest';
import {
  buildExpectedMonthlyCloseIntegrity,
  verifyMonthlyCloseItems,
} from './monthlyCloseIntegrity';
import type { CurrentValuationRow } from './models';

function row(id: string, quantity: number, unitValue: number): CurrentValuationRow {
  return {
    valuationId: id,
    moduleName: 'EPP',
    code: id,
    product: id,
    reference: 'N/A',
    quantity,
    unit: 'Unidad',
    unitValue,
    totalValue: quantity * unitValue,
    includesOccupied: false,
  };
}

describe('integridad recuperable del cierre', () => {
  const rows = [row('existencias__a', 2, 10), row('existencias__b', 3, 20)];

  it('rechaza IDs inválidos o duplicados antes de escribir', () => {
    expect(() => buildExpectedMonthlyCloseIntegrity([row('id/invalido', 1, 1)]))
      .toThrow(/IDs de valoración inválidos/);
    expect(() => buildExpectedMonthlyCloseIntegrity([row('igual', 1, 1), row('igual', 2, 2)]))
      .toThrow(/duplicados/);
  });

  it('rechaza inventario positivo sin valor unitario', () => {
    expect(() => buildExpectedMonthlyCloseIntegrity([row('sin-valor', 2, 0)]))
      .toThrow(/datos inconsistentes/);
  });

  it('detecta un conjunto parcial de ítems', () => {
    const expected = buildExpectedMonthlyCloseIntegrity(rows);
    const verification = verifyMonthlyCloseItems(expected, [
      { id: 'existencias__a', totalValue: 20 },
    ]);
    expect(verification.valid).toBe(false);
    expect(verification.actual.itemCount).toBe(1);
  });

  it('detecta una suma total distinta aunque coincidan los IDs', () => {
    const expected = buildExpectedMonthlyCloseIntegrity(rows);
    expect(verifyMonthlyCloseItems(expected, [
      { id: 'existencias__a', totalValue: 20 },
      { id: 'existencias__b', totalValue: 61 },
    ]).valid).toBe(false);
  });

  it('aprueba la verificación final de IDs, cantidad y suma', () => {
    const expected = buildExpectedMonthlyCloseIntegrity(rows);
    const verification = verifyMonthlyCloseItems(expected, [
      { id: 'existencias__b', totalValue: 60 },
      { id: 'existencias__a', totalValue: 20 },
    ]);
    expect(verification.valid).toBe(true);
    expect(verification.actual).toEqual({
      itemCount: 2,
      totalValue: 80,
      idsHash: expected.idsHash,
    });
  });
});
