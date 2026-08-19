import { describe, expect, it } from 'vitest';
import {
  assertEntryNotValued,
  calculateWeightedAverage,
  DuplicateEntryValuationError,
  inventoryValuationIdForEntry,
  InvalidEntryValuationDataError,
  MissingBaseAverageError,
  sequenceEntryValuations,
} from './entryValuationMath';

describe('calculateWeightedAverage', () => {
  it('calcula el promedio ponderado con el stock anterior', () => {
    expect(calculateWeightedAverage({
      previousStock: 10,
      quantity: 5,
      newStock: 15,
      previousAverage: 100,
      entryUnitValue: 160,
    })).toBe(120);
  });

  it('usa directamente el valor de entrada cuando el stock anterior es cero', () => {
    expect(calculateWeightedAverage({
      previousStock: 0,
      quantity: 3,
      newStock: 3,
      previousAverage: null,
      entryUnitValue: 987.654321,
    })).toBe(987.654321);
  });

  it('rechaza datos de stock inconsistentes o valores negativos', () => {
    expect(() => calculateWeightedAverage({
      previousStock: 2,
      quantity: 3,
      newStock: 8,
      previousAverage: 10,
      entryUnitValue: 20,
    })).toThrow(InvalidEntryValuationDataError);
    expect(() => calculateWeightedAverage({
      previousStock: 0,
      quantity: 1,
      newStock: 1,
      previousAverage: null,
      entryUnitValue: -1,
    })).toThrow(InvalidEntryValuationDataError);
  });

  it('bloquea stock anterior positivo sin promedio base', () => {
    expect(() => calculateWeightedAverage({
      previousStock: 2,
      quantity: 1,
      newStock: 3,
      previousAverage: null,
      entryUnitValue: 50,
    })).toThrow(MissingBaseAverageError);
  });
});

describe('sequenceEntryValuations', () => {
  const entries = [
    { id: 'mov-b', productKey: 'producto-1', createdAtMs: 1_000 },
    { id: 'mov-a', productKey: 'producto-1', createdAtMs: 1_000 },
    { id: 'mov-c', productKey: 'producto-2', createdAtMs: 500 },
  ];

  it('ordena por fecha, luego por ID, y bloquea entradas posteriores del producto', () => {
    const sequenced = sequenceEntryValuations(entries, new Set());
    expect(sequenced.map((entry) => entry.id)).toEqual(['mov-c', 'mov-a', 'mov-b']);
    expect(sequenced.find((entry) => entry.id === 'mov-a')?.blockedByMovementId).toBeNull();
    expect(sequenced.find((entry) => entry.id === 'mov-b')?.blockedByMovementId).toBe('mov-a');
  });

  it('habilita la siguiente entrada cuando la anterior ya fue valorada', () => {
    const sequenced = sequenceEntryValuations(entries, new Set(['mov-a']));
    expect(sequenced.find((entry) => entry.id === 'mov-b')?.blockedByMovementId).toBeNull();
  });
});

describe('duplicados', () => {
  it('rechaza un movimiento ya valorado', () => {
    expect(() => assertEntryNotValued('mov-1', new Set(['mov-1'])))
      .toThrow(DuplicateEntryValuationError);
  });
});

describe('inventoryValuationIdForEntry', () => {
  it.each([
    ['EPP', 'producto 1', 'existencias__producto%201'],
    ['ASEO', 'aseo-1', 'productos_aseo__aseo-1'],
    ['Taller', 'herramienta-1', 'herramientas__herramienta-1'],
  ])('mapea %s a la colección correcta', (moduleName, productId, expected) => {
    expect(inventoryValuationIdForEntry(moduleName, productId)).toBe(expected);
  });
});
