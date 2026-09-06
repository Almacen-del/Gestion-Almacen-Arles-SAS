import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
let env: RulesTestEnvironment;
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-arles-stage2-rules', firestore: {
  rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
} }); });
const paths = ['existencias/P1/lotes_agroquimicos/L1', 'existencias/P1/asignaciones_entradas_agroquimicos/E1',
  'operaciones_lotes_agroquimicos/op1', 'controles_lotes_agroquimicos/P1'];
beforeEach(async () => {
  await env.clearFirestore(); await env.withSecurityRulesDisabled(async ctx => {
    for (const role of ['operador', 'almacenista', 'admin']) await setDoc(doc(ctx.firestore(), `usuarios/${role}`), { rol: role, activo: true });
    await setDoc(doc(ctx.firestore(), 'existencias/P1'), { modulo: 'Agroquimicos', cantidad: 10 });
    for (const path of paths) await setDoc(doc(ctx.firestore(), path), { producto_id: 'P1', numero_lote: 'L1', cantidad_disponible: 10,
      cantidad_inicial: 10, fecha_vencimiento: '2028-05', unidad: 'GRAMO', entrada_id: 'E1', cantidad_entrada: 10, cantidad_asignada: 5,
      respaldo_vencimiento: { mantener: true } });
  });
});
afterAll(async () => { await env?.cleanup(); });
for (const role of ['operador', 'almacenista', 'admin', 'owner']) for (const path of paths) {
  it(`${role} no puede saltarse la transacción por acceso directo a ${path}`, async () => {
    const db = env.authenticatedContext(role, { email: role === 'owner' ? 'almacen@arlessas.com' : `${role}@example.test` }).firestore();
    const ref = doc(db, path);
    await assertFails(updateDoc(ref, { cantidad_disponible: 999 }));
    await assertFails(setDoc(ref, { cantidad_disponible: 0 }));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(db, `${path}-nuevo`), { producto_id: 'P1', numero_lote: 'L2', cantidad_disponible: 1, cantidad_inicial: 1, fecha_vencimiento: '2028-05', unidad: 'GRAMO' }));
    if (role !== 'operador' || path.startsWith('existencias/')) {
      const snapshot = await assertSucceeds(getDoc(ref)); expect(snapshot.data()!.respaldo_vencimiento).toEqual({ mantener: true });
    } else await assertFails(getDoc(ref));
  });
}
