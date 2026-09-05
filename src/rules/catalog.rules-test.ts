import {readFileSync} from 'node:fs';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {collection, deleteDoc, deleteField, doc, getDoc, getDocs, runTransaction, setDoc, updateDoc, writeBatch, type Firestore} from 'firebase/firestore';

let env: RulesTestEnvironment;
const card = {modulo: 'EPP', categoria: 'Proteccion', item: 'Guantes', referencia: 'M', codigo_interno: 'P1', documento_id: 'P1', producto_id: 'P1', unidad: 'Unidad'};
const dbFor = (uid = 'operator') => env.authenticatedContext(uid, {email: uid === 'owner' ? 'almacen@arlessas.com' : `${uid}@arlessas.com`}).firestore() as unknown as Firestore;
beforeAll(async () => {
  env = await initializeTestEnvironment({projectId: 'demo-arles-catalog', firestore: {rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')}});
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, rol, activo] of [['operator', 'operador', true], ['warehouse', 'almacenista', true], ['admin', 'administrador', true], ['inactive', 'admin', false]] as const) {
      await setDoc(doc(context.firestore(), 'usuarios', uid), {rol, activo});
    }
    await setDoc(doc(context.firestore(), 'existencias/P1'), {...card, cantidad: 10, stock_actual: 10});
    await setDoc(doc(context.firestore(), 'catalogo_personalizado/P1'), {...card, fuente_importacion: 'Origen conservado', filas_excel: [4, 8]});
  });
});
afterAll(async () => { await env?.cleanup(); });

describe('Catálogo: permiso limitado y compatibilidad móvil', () => {
  it.each(['warehouse', 'admin', 'owner'])('%s puede crear y editar fichas sin borrar procedencia', async uid => {
    const db = dbFor(uid);
    const newCard = {...card, codigo_interno: 'P2', documento_id: 'P2', producto_id: 'P2', cantidad: 0};
    await assertSucceeds(setDoc(doc(db, 'catalogo_personalizado/P2'), newCard));
    await assertSucceeds(updateDoc(doc(db, 'catalogo_personalizado/P1'), {item: 'Guantes actualizados'}));
    const saved = (await getDoc(doc(db, 'catalogo_personalizado/P1'))).data()!;
    expect(saved.fuente_importacion).toBe('Origen conservado');
    expect(saved.filas_excel).toEqual([4, 8]);
  });
  it('un operador activo consulta fichas, pero no las crea ni edita', async () => {
    const db = dbFor();
    await assertSucceeds(getDocs(collection(db, 'catalogo_personalizado')));
    await assertFails(setDoc(doc(db, 'catalogo_personalizado/P2'), {...card, documento_id: 'P2', producto_id: 'P2'}));
    await assertFails(updateDoc(doc(db, 'catalogo_personalizado/P1'), {item: 'No autorizado'}));
  });
  it('niega lectura y escritura a cuentas inactivas, pendientes y anónimas', async () => {
    for (const db of [dbFor('inactive'), dbFor('pending'), env.unauthenticatedContext().firestore() as unknown as Firestore]) {
      await assertFails(getDoc(doc(db, 'catalogo_personalizado/P1')));
      await assertFails(updateDoc(doc(db, 'catalogo_personalizado/P1'), {item: 'No autorizado'}));
    }
  });
  it.each(['operator', 'warehouse', 'admin', 'owner'])('%s no borra productos del catálogo', async uid => {
    await assertFails(deleteDoc(doc(dbFor(uid), 'catalogo_personalizado/P1')));
  });
  it.each([
    {documento_id: 'otro'}, {producto_id: 'otro'}, {item: ''}, {modulo: ''},
    {codigo_interno: ''}, {categoria: 22}, {unidad: true}, {activo: 'true'},
    {cantidad: -1}, {cantidad: Infinity}, {stock_actual: NaN}, {peso_envase: -3},
    {rol: 'admin'}, {permisos: ['*']},
  ])('rechaza fichas inconsistentes o campos ajenos: %j', async invalid => {
    await assertFails(updateDoc(doc(dbFor('warehouse'), 'catalogo_personalizado/P1'), invalid));
  });
  it('conserva campos históricos y no permite subcolecciones no declaradas', async () => {
    const db = dbFor('admin'), ref = doc(db, 'catalogo_personalizado/P1');
    await assertFails(setDoc(ref, card));
    await assertFails(updateDoc(ref, {fuente_importacion: 'Reescribir historia'}));
    await assertFails(updateDoc(ref, {filas_excel: deleteField()}));
    await assertFails(setDoc(doc(db, 'catalogo_personalizado/P1/privado/extra'), {dato: 1}));
    await assertFails(setDoc(doc(db, 'otra_coleccion/extra'), {dato: 1}));
  });
  it('una entrada de operador funciona al no reescribir la ficha existente', async () => {
    const db = dbFor(), product = doc(db, 'existencias/P1');
    await assertSucceeds(runTransaction(db, async transaction => {
      const before = (await transaction.get(product)).data()!.cantidad;
      transaction.set(product, {cantidad: before + 3.5, stock_actual: before + 3.5}, {merge: true});
      transaction.set(doc(db, 'movimientos/entrada-operador'), {tipo: 'Entrada', cantidad: 3.5, producto_id: 'P1'});
    }));
    expect((await getDoc(product)).data()!.cantidad).toBe(13.5);
    expect((await getDoc(doc(db, 'catalogo_personalizado/P1'))).data()!.item).toBe('Guantes');
  });
  it('reproduce la denegación del cliente antiguo sin escrituras parciales', async () => {
    const db = dbFor(), batch = writeBatch(db);
    batch.update(doc(db, 'existencias/P1'), {cantidad: 13.5, stock_actual: 13.5});
    batch.update(doc(db, 'catalogo_personalizado/P1'), {item: 'Ficha modificada por operador'});
    batch.set(doc(db, 'movimientos/entrada-antigua'), {tipo: 'Entrada', cantidad: 3.5});
    await assertFails(batch.commit());
    expect((await getDoc(doc(db, 'existencias/P1'))).data()!.cantidad).toBe(10);
    expect((await getDoc(doc(db, 'movimientos/entrada-antigua'))).exists()).toBe(false);
  });
  it('permite crear producto y ficha atómicamente para gestión', async () => {
    const db = dbFor('warehouse'), batch = writeBatch(db);
    const product = {...card, codigo_interno: 'P2', documento_id: 'P2', producto_id: 'P2', cantidad: 0, stock_actual: 0};
    batch.set(doc(db, 'existencias/P2'), product);
    batch.set(doc(db, 'catalogo_personalizado/P2'), product);
    await assertSucceeds(batch.commit());
  });
});
