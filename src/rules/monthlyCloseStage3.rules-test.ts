import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { commitMonthlyCloseChunk, recoverAbandonedMonthlyClose, MONTHLY_CLOSE_LEASE_MS } from '../valuation/monthlyCloseLease';
import { currentValuationPeriod, saveMonthlyValuationClose } from '../valuation/monthlyValuation';
import { loadMonthlyActivity } from '../valuation/monthlyActivityStorage';

let env: RulesTestEnvironment;
const period = currentValuationPeriod();
const path = `cierres_valoracion_inventario/${period}`;
const expired = () => Timestamp.fromMillis(Date.now() - MONTHLY_CLOSE_LEASE_MS - 60_000);
const payload = (overrides: Record<string, unknown> = {}) => ({ periodo: period, estado: 'guardando', usuario: 'Warehouse', usuario_uid: 'warehouse',
  intento_id: 'a1', protocolo_cierre: 2, pulso: serverTimestamp(), fecha: serverTimestamp(),
  resumen: { valor_total: 100, cantidad_productos: 1 }, verificacion: { verificado: false, cantidad_items: 0 }, ...overrides });
const dbFor = (uid = 'warehouse') => env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore() as unknown as Firestore;
async function seed(data: Record<string, unknown> = payload({ pulso: expired() })) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), path), data);
    await setDoc(doc(context.firestore(), `${path}/items/old`), { intento_id: 'a1', valor_total: 100 });
    await setDoc(doc(context.firestore(), `${path}/movimientos/old`), { intento_id: 'a1', detalle: { expense: 10 } });
  });
}
const recover = (uid = 'admin', attemptId = 'a1') => recoverAbandonedMonthlyClose({ period, attemptId, userUid: uid, confirmation: `RECUPERAR ${period}`, firestore: dbFor(uid) });
beforeAll(async () => {
  if (!/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Stage 3 tests require the local Firestore emulator on 8088.');
  env = await initializeTestEnvironment({ projectId: 'demo-arles-monthly-stage3', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, rol] of [['warehouse', 'almacenista'], ['admin', 'admin'], ['operator', 'operador']]) {
      await setDoc(doc(context.firestore(), 'usuarios', uid), { activo: true, rol });
    }
  });
});
afterAll(async () => { await env?.cleanup(); });

describe('Stage 3: server-enforced lease, administrative recovery and fencing', () => {
  it('requires protocol 2 and a server pulse to start; rejects forged backdated/future pulses', async () => {
    const db = dbFor(), ref = doc(db, path);
    for (const overrides of [{ protocolo_cierre: 1 }, { pulso: expired() }, { pulso: Timestamp.fromMillis(Date.now() + 60_000) }]) {
      await assertFails(setDoc(ref, payload(overrides)));
    }
    await assertSucceeds(setDoc(ref, payload()));
  });
  it('cannot recover an active attempt even if the browser clock claims it expired', async () => {
    await seed(payload());
    await expect(recover()).rejects.toThrow(/activo/);
    const db = dbFor('admin'), batch = writeBatch(db), before = (await getDoc(doc(db, path))).data()!;
    const recovery = { intento_id: 'a1', por_uid: 'admin', fecha: serverTimestamp(), usuario_original: 'warehouse', ultimo_pulso: before.pulso };
    batch.update(doc(db, path), { estado: 'error', recuperacion: recovery });
    batch.set(doc(db, `${path}/recuperaciones/a1`), recovery);
    await assertFails(batch.commit());
  });
  it.each(['operator', 'unknown'])('denies recovery to %s', async uid => {
    await seed(); await expect(recover(uid)).rejects.toThrow();
    expect((await getDoc(doc(dbFor(), path))).data()!.estado).toBe('guardando');
  });
  it.each(['completo', 'error'])('never recovers a %s close', async estado => {
    await seed(payload({ estado, pulso: expired() })); await expect(recover()).rejects.toThrow(/cambió/);
  });
  it('recovers without changing financial or detail data, and retains an immutable audit record', async () => {
    await seed(); const db = dbFor('admin'), before = (await getDoc(doc(db, path))).data()!;
    await recover(); const after = (await getDoc(doc(db, path))).data()!;
    expect(after).toEqual({ ...before, estado: 'error', recuperacion: expect.any(Object) });
    expect(after.recuperacion).toMatchObject({ por_uid: 'admin', usuario_original: 'warehouse', intento_id: 'a1' });
    expect((await getDoc(doc(db, `${path}/items/old`))).data()).toEqual({ intento_id: 'a1', valor_total: 100 });
    const log = doc(db, `${path}/recuperaciones/a1`);
    expect((await getDoc(log)).data()).toEqual(after.recuperacion);
    await assertFails(deleteDoc(log)); await assertFails(updateDoc(log, { por_uid: 'warehouse' }));
    await expect(recover()).rejects.toThrow();
  });
  it('rejects recovery without its audit record, or with changed amounts/forged actor', async () => {
    await seed(); const db = dbFor('admin'), before = (await getDoc(doc(db, path))).data()!;
    const recovery = { intento_id: 'a1', por_uid: 'admin', fecha: serverTimestamp(), usuario_original: 'warehouse', ultimo_pulso: before.pulso };
    await assertFails(updateDoc(doc(db, path), { estado: 'error', recuperacion: recovery }));
    for (const overrides of [{ resumen: { valor_total: 0, cantidad_productos: 1 } }, { recuperacion: { ...recovery, por_uid: 'operator' } }]) {
      const batch = writeBatch(db);
      batch.update(doc(db, path), { estado: 'error', recuperacion: recovery, ...overrides });
      batch.set(doc(db, `${path}/recuperaciones/a1`), recovery);
      await assertFails(batch.commit());
    }
  });
  it('recovers legacy attempts with server dates but refuses unverifiable dates', async () => {
    const legacy = payload({ fecha: expired() }) as Record<string, unknown>;
    delete legacy.pulso; delete legacy.protocolo_cierre;
    await seed(legacy); await recover();
    await env.clearFirestore();
    // Recreate profiles removed by clearFirestore.
    await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'usuarios/admin'), { activo: true, rol: 'admin' }); });
    await seed({ ...legacy, intento_id: 'a2', fecha: '2026-01-01' });
    await expect(recover('admin', 'a2')).rejects.toThrow(/fecha verificable/);
  });
  it('does not revive an expired attempt via heartbeat, finalization or child writes', async () => {
    await seed(); const db = dbFor();
    await assertFails(updateDoc(doc(db, path), { pulso: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, path), { estado: 'completo', pulso: serverTimestamp(), fecha: serverTimestamp(), verificacion: { verificado: true, cantidad_items: 1 } }));
    await expect(commitMonthlyCloseChunk(period, 'a1', tx => tx.delete(doc(db, `${path}/items/old`)), db)).rejects.toThrow();
  });
  it('fences delayed deletions, writes and finalization from the same user after retry', async () => {
    await seed(); await recover('warehouse'); const db = dbFor(), ref = doc(db, path);
    const recovery = (await getDoc(ref)).data()!.recuperacion;
    await setDoc(ref, payload({ intento_id: 'a2', recuperacion: recovery }));
    for (const action of [
      () => commitMonthlyCloseChunk(period, 'a1', tx => tx.delete(doc(db, `${path}/items/old`)), db),
      () => commitMonthlyCloseChunk(period, 'a1', tx => tx.set(doc(db, `${path}/items/old`), { intento_id: 'a1' }), db),
    ]) await expect(action()).rejects.toThrow(/activo/);
    await assertFails(deleteDoc(doc(db, `${path}/items/old`))); // Unfenced old client.
    await assertFails(updateDoc(ref, { intento_id: 'a1', estado: 'completo', pulso: serverTimestamp(), fecha: serverTimestamp(), verificacion: { verificado: true, cantidad_items: 1 } }));
    await assertSucceeds(commitMonthlyCloseChunk(period, 'a2', tx => tx.delete(doc(db, `${path}/items/old`)), db));
  });
  it('only one concurrent recovery wins; a heartbeat or newer attempt invalidates the requested target', async () => {
    await seed(); const outcomes = await Promise.allSettled([recover('warehouse'), recover('admin')]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getDocs(collection(dbFor(), `${path}/recuperaciones`))).size).toBe(1);
  });
  it('recovery grants retry only for the recovered attempt, not later failures of a different creator', async () => {
    await seed(); await recover('admin'); const db = dbFor(), ref = doc(db, path);
    const recovery = (await getDoc(ref)).data()!.recuperacion;
    await setDoc(ref, payload({ intento_id: 'a2', recuperacion: recovery }));
    await updateDoc(ref, { estado: 'error', pulso: serverTimestamp() });
    await assertFails(setDoc(doc(dbFor('admin'), path), payload({ usuario_uid: 'admin', intento_id: 'a3', recuperacion: recovery })));
    await assertSucceeds(setDoc(ref, payload({ intento_id: 'a3', recuperacion: recovery })));
  });
});

function closeArgs(firestore: Firestore, uid = 'warehouse', count = 1) {
  const rows = Array.from({ length: count }, (_, index) => ({ valuationId: `existencias__p${index}`, code: `P${index}`, moduleName: 'Combustible', product: `Product ${index}`,
    reference: '', quantity: 10, unit: 'Galones', unitValue: 10, totalValue: 100, includesOccupied: false }));
  return { firestore, period, rows, moduleOptions: ['Combustible'], user: { uid, email: `${uid}@example.test` } as User,
    earlyConfirmation: `CERRAR ${period}`, historyComplete: true, onProgress: () => {},
    movements: rows.map((row, index) => ({ id: `m${index}`, module: 'Combustible', type: 'Salida', code: row.code, name: row.product, reference: '', quantity: 2, unit: 'Galones', occurredAt: `${period}-01 00:00`, destinationLot: '24' })) };
}

describe('Stage 3: actual close writer against security rules', () => {
  it('writes and verifies a 451-item close across multiple chunks, then rejects duplicate completion', async () => {
    const db = dbFor(), args = closeArgs(db, 'warehouse', 451);
    const result = await saveMonthlyValuationClose(args);
    expect(result).toMatchObject({ itemCount: 451, totalValue: 45100 });
    const parent = (await getDoc(doc(db, path))).data()!;
    expect(parent.estado).toBe('completo');
    const activity = await loadMonthlyActivity(parent.actividad, db);
    expect(activity.rows).toHaveLength(451);
    expect(activity.rows.reduce((sum, row) => sum + (row.expense ?? 0), 0)).toBe(9020);
    await expect(saveMonthlyValuationClose(args)).rejects.toThrow(/completo/);
    await assertFails(deleteDoc(doc(db, `${path}/items/existencias__p0`)));
  }, 60000);
  it.each([1, 2, 3, 4, 5])('handles interruption at phase %s and rebuilds only the incomplete attempt after explicit recovery', async step => {
    const db = dbFor(), args = closeArgs(db);
    await expect(saveMonthlyValuationClose({ ...args, onProgress: progress => { if (progress === step) throw new Error('Interrupción simulada'); } })).rejects.toThrow(/simulada/);
    const failed = (await getDoc(doc(db, path))).data()!;
    expect(failed.estado).toBe('error'); // Connected failure path.
    // Simulate the same persisted partial phase when the tab died before it
    // could mark error: ONLY the local emulator fixture changes this header.
    await env.withSecurityRulesDisabled(async context => { await updateDoc(doc(context.firestore(), path), { estado: 'guardando', pulso: expired() }); });
    await recover('admin', failed.intento_id);
    const result = await saveMonthlyValuationClose(closeArgs(dbFor('admin'), 'admin'));
    expect(result).toMatchObject({ itemCount: 1, totalValue: 100 });
    const final = (await getDoc(doc(db, path))).data()!;
    expect(final.usuario_uid).toBe('admin'); expect(final.intento_id).not.toBe(failed.intento_id);
    expect((await getDocs(collection(db, `${path}/items`))).size).toBe(1);
    expect((await getDocs(collection(db, `${path}/movimientos`))).size).toBe(1);
    expect((await getDoc(doc(db, `${path}/recuperaciones/${failed.intento_id}`))).exists()).toBe(true);
  }, 30000);
});
