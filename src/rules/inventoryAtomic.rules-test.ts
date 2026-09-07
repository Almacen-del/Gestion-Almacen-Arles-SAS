import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({projectId: 'demo-arles-inventory-rules', firestore: {rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')}});
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const [uid, rol] of [['operator', 'operador'], ['manager', 'almacenista']]) await setDoc(doc(ctx.firestore(), 'usuarios', uid), {rol, activo: true});
    await setDoc(doc(ctx.firestore(), 'existencias/P1'), {modulo: 'Agroquimicos', cantidad: 10, ubicacion: 'COP'});
    await setDoc(doc(ctx.firestore(), 'herramientas/T1'), {cantidad_total: 3, estado: 'Bueno'});
    await setDoc(doc(ctx.firestore(), 'operaciones_inventario/O1'), {usuario_uid: 'operator'});
  });
});
afterAll(async () => { await env?.cleanup(); });
const db = (uid = 'operator') => env.authenticatedContext(uid, {email: uid + '@arlessas.com'}).firestore();
it.each(['operator', 'manager'])('%s cannot write stock alone, forge history or forge receipts', async uid => {
  await assertFails(updateDoc(doc(db(uid), 'existencias/P1'), {cantidad: 9}));
  await assertFails(setDoc(doc(db(uid), 'movimientos/FAKE'), {tipoMovimiento: 'Salida', cantidad: 1, usuario_uid: 'another'}));
  await assertFails(setDoc(doc(db(uid), 'movimientos/EMPTY'), {}));
  await assertFails(setDoc(doc(db(uid), 'operaciones_inventario/FAKE'), {usuario_uid: uid}));
});
it('web location and maintenance edits remain available without stock changes', async () => {
  await assertSucceeds(updateDoc(doc(db('manager'), 'existencias/P1'), {ubicacion: 'Vivero'}));
  await assertSucceeds(updateDoc(doc(db('manager'), 'herramientas/T1'), {estado: 'Mantenimiento'}));
  await assertFails(updateDoc(doc(db('manager'), 'herramientas/T1'), {estado: 'Mantenimiento', cantidad_total: 99}));
  await assertSucceeds(getDoc(doc(db(), 'operaciones_inventario/O1')));
});
