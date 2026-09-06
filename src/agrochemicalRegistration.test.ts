import { describe, expect, it } from 'vitest';
import { clearLotAttempt, isCanonicalAgrochemicalLotPath, isDefinitiveLotRejection, lotAttemptKey, prepareLotAttempt, readLotAttempt, type LotRegistrationIntent } from './agrochemicalRegistration';
const intent: LotRegistrationIntent = { productDocumentId: 'P1', existingLotId: 'C506__2026-05', lotNumber: 'C506',
  expirationDate: '2028-05', quantity: 10, receivedAt: '2026-08-11', sourceEntryId: 'E1', linkExistingLotWithoutStockIncrease: false };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
describe('comprobante durable de asignación', () => {
  it('solo incluye lotes de la ruta oficial, no documentos homónimos de otros módulos o subcolecciones', () => {
    expect(isCanonicalAgrochemicalLotPath('existencias/P1/lotes_agroquimicos/C506__2026-05')).toBe(true);
    for (const path of ['movimientos/P1/lotes_agroquimicos/L1', 'existencias/P1/legacy/P1/lotes_agroquimicos/L1',
      'existencias/P1/lotes_agroquimicos/L1/otra/x', 'lotes_agroquimicos/L1']) expect(isCanonicalAgrochemicalLotPath(path)).toBe(false);
  });
  it('persiste el ID real, fecha corregida y cantidad antes del envío', () => {
    const db = storage(); const attempt = prepareLotAttempt(db, 'demo:uid', intent, () => 'operacion-00000001');
    expect(readLotAttempt(db, 'demo:uid')).toEqual(attempt);
    expect(attempt.existingLotId).toBe('C506__2026-05'); expect(attempt.expirationDate).toBe('2028-05');
  });
  it('no crea otra intención mientras hay un resultado incierto', () => {
    const db = storage(); prepareLotAttempt(db, 'demo:uid', intent, () => 'operacion-00000001');
    expect(() => prepareLotAttempt(db, 'demo:uid', { ...intent, quantity: 20 })).toThrow('pendiente');
    expect(readLotAttempt(db, 'demo:uid')!.quantity).toBe(10);
  });
  it('separa usuarios y proyectos', () => {
    const db = storage(); prepareLotAttempt(db, 'demo:uid', intent, () => 'operacion-00000001');
    expect(readLotAttempt(db, 'otro:uid')).toBeNull(); expect(readLotAttempt(db, 'demo:otra')).toBeNull();
  });
  it('un cierre antiguo no elimina un comprobante diferente', () => {
    const db = storage(); prepareLotAttempt(db, 'demo:uid', intent, () => 'operacion-00000001');
    clearLotAttempt(db, 'demo:uid', 'operacion-00000002'); expect(readLotAttempt(db, 'demo:uid')).not.toBeNull();
    clearLotAttempt(db, 'demo:uid', 'operacion-00000001'); expect(readLotAttempt(db, 'demo:uid')).toBeNull();
  });
  it('no descarta silenciosamente un comprobante ilegible', () => {
    const db = storage(); db.setItem(lotAttemptKey('demo:uid'), '{"operationId": "x"}');
    expect(() => readLotAttempt(db, 'demo:uid')).toThrow('revisión');
  });
  it('si el almacenamiento falla no se prepara un envío sin recuperación', () => {
    const db = storage(); db.setItem = () => { throw new Error('Quota'); };
    expect(() => prepareLotAttempt(db, 'demo:uid', intent)).toThrow('Quota');
  });
  it.each(['unavailable', 'deadline-exceeded', 'internal', 'unknown', 'already-exists'])('conserva comprobante en %s', code => {
    expect(isDefinitiveLotRejection({ code: `functions/${code}` })).toBe(false);
  });
  it.each(['invalid-argument', 'permission-denied', 'unauthenticated', 'not-found', 'failed-precondition'])('reconoce rechazo atómico inicial %s', code => {
    expect(isDefinitiveLotRejection({ code: `functions/${code}` })).toBe(true);
  });
});
