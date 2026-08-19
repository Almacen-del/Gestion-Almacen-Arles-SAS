import { describe, expect, it } from 'vitest';
import { adaptInventoryAnalysisSources } from './sourceAdapter';

describe('adaptador trazable para inventario y movimientos', () => {
  it('prioriza el id real del documento sobre nombres o códigos', () => {
    const result = adaptInventoryAnalysisSources([
      { id: 'producto-1', module: 'Consumibles', code: 'C-1', name: 'Filtro', reference: '', category: 'Motor', unit: 'Unidad' },
    ], [
      { id: 'm1', module: 'Consumibles', type: 'Salida', code: 'OTRO', name: 'Otro', reference: '', quantity: 1, occurredAt: '2026-03-01', productDocumentId: 'producto-1' },
    ]);
    expect(result.movements[0]).toMatchObject({ productId: 'existencias__producto-1', kind: 'exit' });
  });

  it('reconoce los prefijos actuales de ASEO y herramientas', () => {
    const result = adaptInventoryAnalysisSources([
      { id: 'aseo-abc', module: 'ASEO', code: 'H01-001', name: 'Jabón', reference: '', category: 'Aseo', unit: 'Unidad' },
      { id: 'herramienta-qr1', module: 'Taller', code: 'QR-1', name: 'Llave', reference: '', category: 'Taller', unit: 'Unidad' },
    ], [
      { id: 'm1', module: 'ASEO', type: 'Entrada', code: '', name: '', reference: '', quantity: 1, occurredAt: '2026-03-01', productDocumentId: 'abc' },
      { id: 'm2', module: 'Taller', type: 'Entrega', code: '', name: '', reference: '', quantity: 1, occurredAt: '2026-03-01', productDocumentId: 'qr1' },
    ]);
    expect(result.movements.map((movement) => movement.productId)).toEqual([
      'productos_aseo__abc',
      'herramientas__qr1',
    ]);
  });

  it('usa código como respaldo solo cuando identifica un producto único', () => {
    const result = adaptInventoryAnalysisSources([
      { id: 'p1', module: 'EPP', code: 'E-1', name: 'Guante', reference: 'M', category: 'EPP', unit: 'Par' },
    ], [
      { id: 'm1', module: 'EPP', type: 'Salida', code: 'E-1', name: 'Texto antiguo', reference: '', quantity: 2, occurredAt: '2026-03-01' },
    ]);
    expect(result.movements).toHaveLength(1);
  });

  it('no asigna movimientos cuando un código está duplicado', () => {
    const products = [
      { id: 'p1', module: 'Dotación', code: 'D-1', name: 'Bota', reference: '39', category: 'Calzado', unit: 'Par' },
      { id: 'p2', module: 'Dotación', code: 'D-1', name: 'Bota', reference: '40', category: 'Calzado', unit: 'Par' },
    ];
    const result = adaptInventoryAnalysisSources(products, [
      { id: 'm1', module: 'Dotación', type: 'Salida', code: 'D-1', name: '', reference: '', quantity: 1, occurredAt: '2026-03-01' },
    ]);
    expect(result.movements).toEqual([]);
    expect(result.ambiguousMovementIds).toEqual(['m1']);
  });

  it('informa movimientos que no pueden vincularse sin inventar identidad', () => {
    const result = adaptInventoryAnalysisSources([], [
      { id: 'm1', module: 'EPP', type: 'Salida', code: 'X', name: 'Desconocido', reference: '', quantity: 1, occurredAt: '2026-03-01' },
    ]);
    expect(result.unresolvedMovementIds).toEqual(['m1']);
  });
});
