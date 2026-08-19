import { describe, expect, it } from 'vitest';
import { compareInventoryCodes, filterAndSortInventoryView, type InventoryViewRecord } from './inventoryView';

function item(id: string, overrides: Partial<InventoryViewRecord> = {}): InventoryViewRecord {
  return {
    id,
    codigo: `COD-${id}`,
    descripcion: `Producto ${id}`,
    referencia: 'General',
    categoria: 'Consumibles',
    unidad: 'Unidad',
    ...overrides,
  };
}

describe('vista web del inventario', () => {
  it('busca sin depender de mayúsculas ni tildes y cubre campos operativos', () => {
    const records = [
      item('1', { codigo: 'AG-001', descripcion: 'Ácido cítrico', ubicacion: 'Bodega Química' }),
      item('2', { codigo: 'AS-002', descripcion: 'Jabón', codigoQr: 'QR-145', caracteristica: 'Espuma suave' }),
    ];

    expect(filterAndSortInventoryView(records, 'acido').map((entry) => entry.id)).toEqual(['1']);
    expect(filterAndSortInventoryView(records, 'bodega quimica').map((entry) => entry.id)).toEqual(['1']);
    expect(filterAndSortInventoryView(records, 'qr-145').map((entry) => entry.id)).toEqual(['2']);
    expect(filterAndSortInventoryView(records, 'espuma').map((entry) => entry.id)).toEqual(['2']);
  });

  it('ordena códigos de forma natural y estable', () => {
    const records = [
      item('10', { codigo: 'ITEM-10' }),
      item('2', { codigo: 'ITEM-2' }),
      item('1', { codigo: 'ITEM-1' }),
    ];

    expect(filterAndSortInventoryView(records, '').map((entry) => entry.codigo))
      .toEqual(['ITEM-1', 'ITEM-2', 'ITEM-10']);
    expect(compareInventoryCodes('QR-9', 'QR-10')).toBeLessThan(0);
  });
});
