import type { CurrentValuationRow } from './models';

const TOTAL_TOLERANCE = 1e-6;

export type MonthlyCloseIntegrity = {
  itemCount: number;
  totalValue: number;
  idsHash: string;
  ids: string[];
};

export type StoredCloseItem = {
  id: string;
  totalValue: number;
};

function closeEnough(left: number, right: number) {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= TOTAL_TOLERANCE * scale;
}

export function hashMonthlyCloseIds(ids: string[]) {
  let hash = 0x811c9dc5;
  ids.forEach((id) => {
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 124;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  });
  return hash.toString(16).padStart(8, '0');
}

export function buildExpectedMonthlyCloseIntegrity(rows: CurrentValuationRow[]): MonthlyCloseIntegrity {
  if (rows.length === 0) throw new Error('El corte no contiene productos.');
  const ids = rows.map((row) => row.valuationId).sort((left, right) => left.localeCompare(right));
  if (ids.some((id) => !id.trim() || id.includes('/'))) {
    throw new Error('El corte contiene IDs de valoración inválidos.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('El corte contiene IDs de valoración duplicados.');
  }

  rows.forEach((row) => {
    if (
      !Number.isFinite(row.quantity)
      || row.quantity < 0
      || !Number.isFinite(row.unitValue)
      || row.unitValue < 0
      || (row.quantity > 0 && row.unitValue <= 0)
      || !Number.isFinite(row.totalValue)
      || row.totalValue < 0
      || !closeEnough(row.totalValue, row.quantity * row.unitValue)
    ) {
      throw new Error(`El producto ${row.valuationId} tiene datos inconsistentes.`);
    }
  });

  return {
    itemCount: rows.length,
    totalValue: rows.reduce((sum, row) => sum + row.totalValue, 0),
    idsHash: hashMonthlyCloseIds(ids),
    ids,
  };
}

export function verifyMonthlyCloseItems(
  expected: MonthlyCloseIntegrity,
  items: StoredCloseItem[],
) {
  const ids = items.map((item) => item.id).sort((left, right) => left.localeCompare(right));
  const totalValue = items.reduce((sum, item) => sum + item.totalValue, 0);
  const validNumbers = items.every((item) => Number.isFinite(item.totalValue) && item.totalValue >= 0);
  const actual = {
    itemCount: items.length,
    totalValue,
    idsHash: hashMonthlyCloseIds(ids),
  };
  return {
    valid: validNumbers
      && actual.itemCount === expected.itemCount
      && actual.idsHash === expected.idsHash
      && closeEnough(actual.totalValue, expected.totalValue),
    actual,
  };
}
