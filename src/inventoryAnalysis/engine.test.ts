import { describe, expect, it } from 'vitest';
import { analyzeInventoryPeriod, classifyInventoryMovementType, validateCurrentStockAtCutoff } from './engine';
import type { InventoryAnalysisMovement, InventoryAnalysisProduct } from './models';

const product: InventoryAnalysisProduct = {
  id: 'existencias__producto-1',
  code: 'P-001',
  name: 'Producto de prueba',
  category: 'Pruebas',
  unit: 'Unidad',
  module: 'Consumibles',
};

function movement(
  id: string,
  occurredAt: string,
  kind: InventoryAnalysisMovement['kind'],
  quantity: number,
  stockBefore?: number,
  stockAfter?: number,
): InventoryAnalysisMovement {
  return { id, productId: product.id, occurredAt, kind, quantity, stockBefore, stockAfter };
}

describe('motor de rotación histórica', () => {
  it('calcula inventario inicial, final, promedio y rotación desde anclas históricas', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('m1', '2026-03-02 08:00', 'entry', 20, 100, 120),
      movement('m2', '2026-03-18 09:00', 'exit', 60, 120, 60),
      movement('m3', '2026-03-25 10:00', 'exit', 20, 60, 40),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result).toMatchObject({
      openingInventory: 100,
      entries: 20,
      exits: 80,
      otherChanges: 0,
      closingInventory: 40,
      averageInventory: 70,
      quality: 'exact',
    });
    expect(result.turnover).toBeCloseTo(80 / 70);
    expect(result.evidence.exitMovementIds).toEqual(['m2', 'm3']);
  });

  it('reconstruye un mes anterior sin consultar ni recibir el stock actual', () => {
    const movements = [
      movement('jan-entry', '2026-01-05', 'entry', 10, 40, 50),
      movement('jan-exit', '2026-01-20', 'exit', 20, 50, 30),
      movement('feb-entry', '2026-02-10', 'entry', 5, 30, 35),
    ];

    const january = analyzeInventoryPeriod(product, movements, { from: '2026-01-01', to: '2026-01-31' });
    expect(january).toMatchObject({ openingInventory: 40, closingInventory: 30, entries: 10, exits: 20 });
  });

  it('consulta otro año usando únicamente movimientos de ese corte', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('old', '2025-12-20', 'entry', 5, 10, 15),
      movement('current', '2026-01-10', 'exit', 3, 15, 12),
    ], { from: '2025-12-01', to: '2025-12-31' });

    expect(result).toMatchObject({ openingInventory: 10, entries: 5, exits: 0, closingInventory: 15 });
  });

  it('usa una ancla posterior para reconstruir el inicio si la ruta completa es conocida', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('m1', '2026-03-02', 'entry', 10),
      movement('m2', '2026-03-03', 'exit', 5),
      movement('m3', '2026-04-01', 'entry', 20, 35, 55),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result).toMatchObject({ openingInventory: 30, closingInventory: 35, quality: 'exact' });
  });

  it('no inventa saldos cuando no existe ninguna ancla histórica', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('m1', '2026-03-02', 'entry', 10),
      movement('m2', '2026-03-03', 'exit', 5),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result.openingInventory).toBeNull();
    expect(result.closingInventory).toBeNull();
    expect(result.averageInventory).toBeNull();
    expect(result.turnover).toBeNull();
    expect(result.quality).toBe('insufficient');
    expect(result.issues.map((issue) => issue.code)).toContain('missing-balance-anchor');
  });

  it('rechaza anclas contradictorias en vez de escoger una arbitrariamente', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('m1', '2026-03-02', 'entry', 10, 20, 30),
      movement('m2', '2026-03-03', 'exit', 5, 50, 45),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result.openingInventory).toBeNull();
    expect(result.quality).toBe('inconsistent');
    expect(result.issues.map((issue) => issue.code)).toContain('conflicting-balance-anchors');
  });

  it('muestra N/A mediante rotación nula cuando el inventario promedio es cero', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('m1', '2026-03-02', 'entry', 0, 0, 0),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result.averageInventory).toBe(0);
    expect(result.turnover).toBeNull();
  });

  it('calcula días sin movimiento contra el cierre consultado, no contra hoy', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('feb-exit', '2026-02-20 08:00', 'exit', 1, 10, 9),
      movement('mar-entry', '2026-03-05 08:00', 'entry', 2, 9, 11),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result.lastEntryDate).toBe('2026-03-05');
    expect(result.lastExitDate).toBe('2026-02-20');
    expect(result.daysWithoutMovement).toBe(39);
  });

  it('distingue un producto sin salidas registradas mediante valores nulos', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('entry', '2026-03-05', 'entry', 2, 0, 2),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result.lastExitDate).toBeNull();
    expect(result.daysWithoutMovement).toBeNull();
  });

  it('mantiene los traslados neutrales para el análisis global del producto', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('entry', '2026-03-01', 'entry', 10, 5, 15),
      movement('transfer', '2026-03-10', 'transfer', 3, 15, 15),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result).toMatchObject({ entries: 10, exits: 0, otherChanges: 0, openingInventory: 5, closingInventory: 15 });
    expect(result.evidence.otherMovementIds).toEqual(['transfer']);
  });

  it('separa los ajustes del total de entradas y salidas', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('entry', '2026-03-01', 'entry', 10, 5, 15),
      movement('adjustment', '2026-03-10', 'adjustment', 0, 15, 13),
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result).toMatchObject({ entries: 10, exits: 0, otherChanges: -2, openingInventory: 5, closingInventory: 13 });
  });

  it('no mezcla movimientos de otro producto', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('own', '2026-03-01', 'entry', 5, 10, 15),
      { ...movement('other', '2026-03-02', 'exit', 100, 100, 0), productId: 'otro-producto' },
    ], { from: '2026-03-01', to: '2026-03-31' });

    expect(result).toMatchObject({ entries: 5, exits: 0, closingInventory: 15 });
  });

  it('no proyecta saldos hacia meses anteriores al inicio conocido del historial', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('june', '2026-06-08', 'entry', 10, 20, 30),
    ], { from: '2026-05-01', to: '2026-05-31', historyCoverageFrom: '2026-06-06' });

    expect(result.openingInventory).toBeNull();
    expect(result.closingInventory).toBeNull();
    expect(result.quality).toBe('insufficient');
    expect(result.issues.map((issue) => issue.code)).toContain('period-before-history-coverage');
  });

  it('usa el stock actual solo como validación del corte actual, nunca como fórmula histórica', () => {
    const calculated = analyzeInventoryPeriod(product, [
      movement('m1', '2026-08-01', 'entry', 10, 20, 30),
    ], { from: '2026-08-01', to: '2026-08-18' });
    const validated = validateCurrentStockAtCutoff(calculated, 25, true);

    expect(validated.closingInventory).toBe(30);
    expect(validated.quality).toBe('inconsistent');
    expect(validated.issues.map((issue) => issue.code)).toContain('current-stock-mismatch');
  });

  it('rechaza fechas imposibles', () => {
    const result = analyzeInventoryPeriod(product, [
      movement('bad-date', '2026-02-31', 'entry', 1, 0, 1),
    ], { from: '2026-02-01', to: '2026-02-28' });
    expect(result.issues.map((issue) => issue.code)).toContain('invalid-date');
    expect(result.quality).toBe('insufficient');
  });
});

describe('clasificación base de tipos de movimiento', () => {
  it.each([
    ['Entrada', 'entry'],
    ['Ingreso bodega', 'entry'],
    ['Salida', 'exit'],
    ['Entrega EPP', 'exit'],
    ['Consumo', 'exit'],
    ['Traslado', 'transfer'],
    ['Ajuste de inventario', 'adjustment'],
    ['Conteo', 'unknown'],
  ] as const)('clasifica %s como %s', (rawType, expected) => {
    expect(classifyInventoryMovementType(rawType)).toBe(expected);
  });
});
