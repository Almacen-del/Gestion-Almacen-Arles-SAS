import { describe, expect, it } from 'vitest';
import { isExcludedEntryStockMovement } from './entryMovementScope';

describe('alcance de entradas de stock valorables', () => {
  it('excluye una devolución identificada en observaciones', () => {
    expect(isExcludedEntryStockMovement({
      clase_movimiento: 'entrada_stock',
      tipoMovimiento: 'Entrada',
      observaciones: 'Devolución',
    })).toBe(true);
  });

  it('conserva una entrada de compra normal', () => {
    expect(isExcludedEntryStockMovement({
      clase_movimiento: 'entrada_stock',
      tipoMovimiento: 'Entrada',
      observaciones: 'Compra nueva para inventario',
    })).toBe(false);
  });

  it('mantiene las exclusiones por tipo, bandera o traslado entre ubicaciones', () => {
    expect(isExcludedEntryStockMovement({ tipo: 'Retorno a proveedor' })).toBe(true);
    expect(isExcludedEntryStockMovement({ es_devolucion: true })).toBe(true);
    expect(isExcludedEntryStockMovement({
      ubicacion_origen: 'Bodega A',
      ubicacion_destino: 'Bodega B',
    })).toBe(true);
  });
});
