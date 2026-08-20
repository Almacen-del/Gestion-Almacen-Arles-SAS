import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeAseoCode,
  reconcileHistoricalInventory,
} = require('../../admin/reconcileHistoricalInventory.cjs') as {
  normalizeAseoCode: (value: string) => string;
  reconcileHistoricalInventory: (input: {
    existencias: Array<{ id: string; updateTime: string | null; data: Record<string, unknown> }>;
    productosAseo: Array<{ id: string; updateTime: string | null; data: Record<string, unknown> }>;
    movimientos?: Array<{ id: string; updateTime: string | null; data: Record<string, unknown> }>;
  }) => {
    rows: Array<Record<string, unknown>>;
    movementEvidence: Array<Record<string, unknown>>;
    summary: {
      statusCounts: Record<string, number>;
      scope: { excludedModule: string; expectedCountAfterApprovedPromotions: number };
    };
  };
};
const { buildMigrationDryRun } = require('../../admin/simulateHistoricalInventoryMigration.cjs') as {
  buildMigrationDryRun: (rows: Array<Record<string, string>>) => {
    ready: boolean;
    blockers: Array<{ historicalId: string; reason: string }>;
    proposedWrites: Array<Record<string, unknown>>;
  };
};

function document(id: string, data: Record<string, unknown>) {
  return { id, updateTime: null, data };
}

describe('conciliación auditable de inventario histórico', () => {
  it('normaliza códigos de ASEO sin inventar uno ausente', () => {
    expect(normalizeAseoCode('h01 002')).toBe('H01-002');
    expect(normalizeAseoCode('')).toBe('');
  });

  it('vincula una coincidencia única sin sumar saldos', () => {
    const result = reconcileHistoricalInventory({
      existencias: [
        document('hist', { modulo: 'ASEO HISTÓRICO', codigo_interno: 'H01-002', item: 'Jabón', cantidad: 4 }),
      ],
      productosAseo: [
        document('activo', { codigo_interno: 'H01002', producto: 'Jabón', stock_actual: 7 }),
      ],
    });
    expect(result.rows[0]).toMatchObject({
      activeId: 'activo',
      historicalStock: 4,
      activeStock: 7,
      status: 'different-stock',
      proposedAction: 'link-history-to-active-do-not-sum',
    });
  });

  it('deja un histórico sin coincidencia pendiente de conteo físico', () => {
    const result = reconcileHistoricalInventory({
      existencias: [
        document('hist', { modulo: 'Consumibles historico', codigo_interno: 'C-9', item: 'Filtro', cantidad: 2 }),
        document('taller', { modulo: 'TALLER', codigo_interno: 'T-1', item: 'Llave', cantidad: 1 }),
      ],
      productosAseo: [],
    });
    expect(result.rows[0]).toMatchObject({
      status: 'historical-only',
      proposedAction: 'promote-after-physical-count',
    });
    expect(result.summary.scope.excludedModule).toBe('TALLER');
    expect(result.summary.scope.expectedCountAfterApprovedPromotions).toBe(1);
  });

  it('detiene coincidencias ambiguas para revisión manual', () => {
    const result = reconcileHistoricalInventory({
      existencias: [
        document('activo-1', { modulo: 'Consumibles', codigo_interno: 'C-1', item: 'Filtro', cantidad: 2 }),
        document('activo-2', { modulo: 'Consumibles', codigo_interno: 'C-1', item: 'Filtro alterno', cantidad: 3 }),
        document('hist', { modulo: 'Consumibles historico', codigo_interno: 'C-1', item: 'Filtro', cantidad: 2 }),
      ],
      productosAseo: [],
    });
    expect(result.rows[0]).toMatchObject({
      status: 'ambiguous-active-match',
      proposedAction: 'manual-review',
    });
  });

  it('usa el último saldo trazable como evidencia sin cambiar automáticamente la decisión', () => {
    const result = reconcileHistoricalInventory({
      existencias: [
        document('activo', { modulo: 'Consumibles', codigo_interno: 'C-1', item: 'Filtro', cantidad: 7 }),
        document('hist', { modulo: 'Consumibles historico', codigo_interno: 'C-1-H', item: 'Filtro', cantidad: 2 }),
      ],
      productosAseo: [],
      movimientos: [
        document('mov-1', {
          modulo: 'Consumibles',
          documento_id: 'activo',
          codigo_interno: 'C-1',
          item: 'Filtro',
          fecha: '2026-08-19T10:00:00.000Z',
          stock_anterior: 8,
          stock_nuevo: 7,
        }),
      ],
    });
    expect(result.rows[0]).toMatchObject({
      status: 'different-stock',
      latestMovementId: 'mov-1',
      latestStockAfter: 7,
      movementEvidenceResult: 'latest-movement-supports-active-stock',
      approvedAction: '',
    });
    expect(result.movementEvidence).toHaveLength(1);
  });
});

describe('simulación de migración histórica', () => {
  it('bloquea cualquier propuesta sin conteo físico ni aprobación trazable', () => {
    const result = buildMigrationDryRun([{
      historicalId: 'hist-1',
      status: 'historical-only',
      approvedAction: '',
      physicalCount: '',
      physicalCountDate: '',
      verifiedBy: '',
      evidenceReference: '',
    }]);
    expect(result.ready).toBe(false);
    expect(result.proposedWrites).toEqual([]);
    expect(result.blockers.map((blocker) => blocker.reason)).toContain('physical-count-required');
  });

  it('propone promover un producto contado en cero como sin existencias', () => {
    const result = buildMigrationDryRun([{
      historicalId: 'hist-1',
      historicalUpdateTime: '2026-08-20T10:00:00.000Z',
      activeModule: 'Consumibles',
      status: 'historical-only',
      approvedAction: 'promote-as-active',
      physicalCount: '0',
      physicalCountDate: '2026-08-20',
      verifiedBy: 'Responsable de almacén',
      evidenceReference: 'ACTA-001',
    }]);
    expect(result.ready).toBe(true);
    expect(result.proposedWrites[0]).toMatchObject({
      documentId: 'hist-1',
      fields: { modulo: 'Consumibles', cantidad: 0, estado: 'Sin existencias' },
    });
  });
});
