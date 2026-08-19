import { describe, expect, it } from 'vitest';
import {
  createInitialFirestoreSourceStates,
  FIRESTORE_SOURCE_KEYS,
  type FirestoreSourceState,
} from './firestoreSync';
import {
  assertCurrentBogotaPeriod,
  currentBogotaPeriod,
  evaluateMonthlyCloseEligibility,
  isEarlyCloseConfirmationValid,
} from './monthlyCloseSafety';
import type { CurrentValuationRow } from './models';

const serverState: FirestoreSourceState = {
  received: true,
  fromCache: false,
  hasPendingWrites: false,
  error: '',
};

function readySources() {
  const states = createInitialFirestoreSourceStates();
  FIRESTORE_SOURCE_KEYS.forEach((key) => { states[key] = { ...serverState }; });
  return states;
}

function valuedRow(overrides: Partial<CurrentValuationRow> = {}): CurrentValuationRow {
  return {
    valuationId: 'existencias__producto-1',
    moduleName: 'EPP',
    code: 'P-1',
    product: 'Producto 1',
    reference: 'N/A',
    quantity: 2,
    unit: 'Unidad',
    unitValue: 50,
    totalValue: 100,
    includesOccupied: false,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof evaluateMonthlyCloseEligibility>[0]> = {}) {
  return {
    period: '2026-07',
    now: new Date('2026-08-01T04:00:00.000Z'),
    online: true,
    sources: readySources(),
    closesSource: { ...serverState },
    rows: [valuedRow()],
    pendingEntryCount: 0,
    inconsistentEntryCount: 0,
    existingCloseStatus: null,
    existingCloseCreatorUid: '',
    userUid: 'user-1',
    ...overrides,
  };
}

describe('elegibilidad del cierre mensual', () => {
  it('habilita el cierre únicamente con todas las fuentes recibidas del servidor', () => {
    const result = evaluateMonthlyCloseEligibility(input());
    expect(result.eligible).toBe(true);
    expect(result.requiresEarlyConfirmation).toBe(false);
  });

  it('bloquea datos parciales, caché, errores y escrituras pendientes', () => {
    const partial = readySources();
    partial.inventory = { ...serverState, received: false };
    expect(evaluateMonthlyCloseEligibility(input({ sources: partial })).reasons)
      .toContain('existencias no ha terminado de cargar.');

    const cached = readySources();
    cached.aseo = { ...serverState, fromCache: true };
    expect(evaluateMonthlyCloseEligibility(input({ sources: cached })).reasons)
      .toContain('productos_aseo todavía usa datos de caché.');

    const pendingWrites = readySources();
    pendingWrites.valuations = { ...serverState, hasPendingWrites: true };
    expect(evaluateMonthlyCloseEligibility(input({ sources: pendingWrites })).eligible).toBe(false);
  });

  it('no exige herramientas porque TALLER no pertenece a la valoración del inventario', () => {
    const toolsUnavailable = readySources();
    toolsUnavailable.tools = { ...serverState, error: 'permission-denied' };
    expect(evaluateMonthlyCloseEligibility(input({ sources: toolsUnavailable })).eligible).toBe(true);
  });

  it('bloquea entradas pendientes o inconsistentes', () => {
    expect(evaluateMonthlyCloseEligibility(input({ pendingEntryCount: 2 })).eligible).toBe(false);
    expect(evaluateMonthlyCloseEligibility(input({ inconsistentEntryCount: 1 })).reasons)
      .toContain('Hay 1 entrada(s) de stock inconsistentes.');
  });

  it('bloquea productos con cantidad positiva y valor menor o igual a cero', () => {
    const withoutValue = valuedRow({ unitValue: 0, totalValue: 0 });
    expect(evaluateMonthlyCloseEligibility(input({ rows: [withoutValue] })).eligible).toBe(false);

    const zeroStock = valuedRow({ quantity: 0, unitValue: 0, totalValue: 0 });
    expect(evaluateMonthlyCloseEligibility(input({ rows: [zeroStock] })).eligible).toBe(true);
  });

  it('permite reintentar solo un cierre en error y bloquea completos o guardando', () => {
    expect(evaluateMonthlyCloseEligibility(input({
      existingCloseStatus: 'error',
      existingCloseCreatorUid: 'user-1',
    })).eligible).toBe(true);
    expect(evaluateMonthlyCloseEligibility(input({
      existingCloseStatus: 'error',
      existingCloseCreatorUid: 'otro-usuario',
    })).eligible).toBe(false);
    expect(evaluateMonthlyCloseEligibility(input({ existingCloseStatus: 'completo' })).eligible).toBe(false);
    expect(evaluateMonthlyCloseEligibility(input({ existingCloseStatus: 'guardando' })).eligible).toBe(false);
  });

  it('exige la frase exacta antes del último día del mes', () => {
    const result = evaluateMonthlyCloseEligibility(input({
      now: new Date('2026-07-13T17:00:00.000Z'),
    }));
    expect(result.requiresEarlyConfirmation).toBe(true);
    expect(result.confirmationText).toBe('CERRAR 2026-07');
    expect(isEarlyCloseConfirmationValid('CERRAR 2026-07', result.confirmationText)).toBe(true);
    expect(isEarlyCloseConfirmationValid('cerrar 2026-07', result.confirmationText)).toBe(false);
  });

  it('rechaza cierres futuros y retroactivos respecto de America/Bogota', () => {
    const now = new Date('2026-07-13T17:00:00.000Z');
    expect(currentBogotaPeriod(now)).toBe('2026-07');
    expect(() => assertCurrentBogotaPeriod('2026-08', now)).toThrow(/no es el mes actual/);
    expect(() => assertCurrentBogotaPeriod('2026-06', now)).toThrow(/no es el mes actual/);
  });
});
