import { describe, expect, it } from 'vitest';
import {
  agrochemicalLotDocumentId,
  allocateAgrochemicalExitFefo,
  buildAgrochemicalEntryQueue,
  classifyAgrochemicalLot,
  earliestAvailableLotExpirationByProduct,
  type AgrochemicalLot,
} from './agrochemicalLots';

function lot(id: string, expirationDate: string, quantity: number): AgrochemicalLot {
  return {
    id,
    productDocumentId: 'product-1',
    productCode: 'FER-1',
    productName: 'Fertilizante',
    lotNumber: id,
    expirationDate,
    quantity,
    initialQuantity: quantity,
    unit: 'KG',
    location: 'BODEGA AZUL',
    receivedAt: '2026-08-20',
    entryAssignments: [],
  };
}

describe('lotes de agroquímicos', () => {
  it('mantiene lotes distintos cuando cambia lote o vencimiento', () => {
    expect(agrochemicalLotDocumentId('Lote 01', '2027-01-10')).toBe('LOTE-01__2027-01-10');
    expect(agrochemicalLotDocumentId('Lote 01', '2027-02-10')).not.toBe('LOTE-01__2027-01-10');
  });

  it('clasifica vencidos y próximos a vencer por fecha', () => {
    expect(classifyAgrochemicalLot(lot('A', '2026-08-19', 1), '2026-08-20')).toBe('expired');
    expect(classifyAgrochemicalLot(lot('B', '2026-09-10', 1), '2026-08-20')).toBe('near-expiry');
    expect(classifyAgrochemicalLot(lot('C', '2027-01-01', 1), '2026-08-20')).toBe('valid');
  });

  it('interpreta un vencimiento mensual hasta el último día del mes', () => {
    expect(classifyAgrochemicalLot(lot('M', '2026-08', 1), '2026-08-20')).toBe('near-expiry');
    expect(classifyAgrochemicalLot(lot('M', '2026-08', 1), '2026-09-01')).toBe('expired');
    expect(agrochemicalLotDocumentId('LOTE MES', '2028-02')).toBe('LOTE-MES__2028-02');
  });

  it('expone por producto el vencimiento más cercano que todavía tiene existencias', () => {
    const agotado = lot('agotado', '2025-01-01', 0);
    const siguiente = lot('siguiente', '2027-02', 3);
    const anterior = lot('anterior', '2026-12-15', 2);
    const otroProducto = lot('otro', '2028-01-01', 1);
    otroProducto.productDocumentId = 'product-2';

    expect(earliestAvailableLotExpirationByProduct([
      siguiente,
      agotado,
      otroProducto,
      anterior,
    ])).toEqual(new Map([
      ['product-1', '2026-12-15'],
      ['product-2', '2028-01-01'],
    ]));
  });

  it('asigna la salida al vencimiento más cercano sin mezclar los lotes', () => {
    const result = allocateAgrochemicalExitFefo([
      lot('nuevo', '2027-08-20', 10),
      lot('anterior', '2027-01-10', 4),
    ], 6, '2026-08-20');
    expect(result).toEqual({
      allocations: [
        { lotId: 'anterior', lotNumber: 'anterior', expirationDate: '2027-01-10', quantity: 4 },
        { lotId: 'nuevo', lotNumber: 'nuevo', expirationDate: '2027-08-20', quantity: 2 },
      ],
      shortage: 0,
    });
  });

  it('no propone despachar lotes vencidos', () => {
    const result = allocateAgrochemicalExitFefo([
      lot('vencido', '2026-08-19', 8),
      lot('vigente', '2027-01-10', 2),
    ], 4, '2026-08-20');
    expect(result.allocations).toEqual([
      { lotId: 'vigente', lotNumber: 'vigente', expirationDate: '2027-01-10', quantity: 2 },
    ]);
    expect(result.shortage).toBe(2);
  });

  it('identifica una entrada móvil pendiente y evita asignarla dos veces', () => {
    const baseEntry = {
      id: 'entry-1',
      productDocumentId: 'product-1',
      moduleName: 'Agroquímicos',
      code: 'FER-1',
      productName: 'Fertilizante',
      quantity: 10,
      unit: 'KG',
      dateLabel: '20/08/2026',
      dateKey: '2026-08-20',
      createdAtMs: 1,
      validationIssue: '',
    };
    expect(buildAgrochemicalEntryQueue([baseEntry], [])[0]).toMatchObject({
      pendingQuantity: 10,
      assignmentStatus: 'pending',
    });
    const assignedLot = lot('A', '2027-01-10', 10);
    assignedLot.entryAssignments = [{ entryId: 'entry-1', quantity: 10 }];
    expect(buildAgrochemicalEntryQueue([baseEntry], [assignedLot])[0]).toMatchObject({
      assignedQuantity: 10,
      pendingQuantity: 0,
      assignmentStatus: 'assigned',
    });
  });
});
