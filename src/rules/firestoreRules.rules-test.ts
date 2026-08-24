import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collectionGroup, doc, getDoc, getDocs, query, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  emptyValuationRevision,
  ManualValuationConflictError,
  saveManualUnitValuation,
  valuationRevisionFromData,
} from '../valuation/manualValuation';

const PROJECT_ID = 'demo-arles-gestion';
const OWNER_EMAIL = 'almacen@arlessas.com';
const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

let testEnvironment: RulesTestEnvironment;

async function seedUser(uid: string, profile: Record<string, unknown>) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'usuarios', uid), profile);
    await setDoc(doc(context.firestore(), 'existencias', 'producto-prueba'), { saldo: 1 });
  });
}

function inventoryRead(uid: string, email = `${uid}@example.com`) {
  const context = testEnvironment.authenticatedContext(uid, { email });
  return getDoc(doc(context.firestore(), 'existencias', 'producto-prueba'));
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('isActiveUser en firestore.rules', () => {
  it('permite un usuario con estado activo y rol permitido', async () => {
    await seedUser('activo', { estado: 'Activo', rol: 'almacenista' });
    await assertSucceeds(inventoryRead('activo'));
  });

  it('bloquea un usuario activo con rol no permitido', async () => {
    await seedUser('sin-rol', { activo: true, rol: 'visitante' });
    await assertFails(inventoryRead('sin-rol'));
  });

  it('bloquea un usuario con rol permitido pero sin estado activo', async () => {
    await seedUser('sin-estado', { rol: 'operador' });
    await assertFails(inventoryRead('sin-estado'));
  });

  it('bloquea usuarios desactivados aunque conserven un estado o rol permitido', async () => {
    await seedUser('inactivo', { activo: false, estado: 'activo', rol: 'admin' });
    await assertFails(inventoryRead('inactivo'));
  });

  it('mantiene el acceso del propietario sin documento de usuario', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'existencias', 'producto-prueba'), { saldo: 1 });
    });
    await assertSucceeds(inventoryRead('propietario', OWNER_EMAIL));
  });



  it('bloquea lecturas sin autenticación', async () => {
    const context = testEnvironment.unauthenticatedContext();
    await assertFails(getDoc(doc(context.firestore(), 'existencias', 'producto-prueba')));
  });

  it('un almacenista no puede cambiar perfiles ni roles de usuarios', async () => {
    await seedUser('almacenista', { activo: true, rol: 'almacenista' });
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'usuarios', 'otro'), { activo: true, rol: 'operador' });
    });
    const context = testEnvironment.authenticatedContext('almacenista', { email: 'almacenista@example.com' });
    await assertFails(setDoc(doc(context.firestore(), 'usuarios', 'otro'), {
      activo: true,
      rol: 'admin',
    }));
  });

  it('un administrador activo puede gestionar perfiles', async () => {
    await seedUser('admin-activo', { activo: true, rol: 'admin' });
    const context = testEnvironment.authenticatedContext('admin-activo', { email: 'admin@example.com' });
    await assertSucceeds(setDoc(doc(context.firestore(), 'usuarios', 'nuevo-operador'), {
      activo: true,
      rol: 'operador',
    }));
  });

  it('un correo corporativo puede crear solamente su perfil pendiente', async () => {
    const context = testEnvironment.authenticatedContext('nuevo-usuario', { email: 'nuevo@arlessas.com' });
    await assertSucceeds(setDoc(doc(context.firestore(), 'usuarios', 'nuevo-usuario'), {
      email: 'nuevo@arlessas.com',
      rol: 'pendiente',
      activo: false,
      estado: 'pendiente',
    }));
  });

  it('un usuario pendiente puede leer únicamente su propio perfil', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'usuarios', 'pendiente-propio'), {
        email: 'pendiente@arlessas.com', rol: 'pendiente', activo: false, estado: 'pendiente',
      });
      await setDoc(doc(context.firestore(), 'usuarios', 'pendiente-ajeno'), {
        email: 'otro@arlessas.com', rol: 'pendiente', activo: false, estado: 'pendiente',
      });
    });
    const context = testEnvironment.authenticatedContext('pendiente-propio', { email: 'pendiente@arlessas.com' });
    await assertSucceeds(getDoc(doc(context.firestore(), 'usuarios', 'pendiente-propio')));
    await assertFails(getDoc(doc(context.firestore(), 'usuarios', 'pendiente-ajeno')));
  });

  it('rechaza la creación de perfiles pendientes fuera del dominio corporativo', async () => {
    const context = testEnvironment.authenticatedContext('correo-externo', { email: 'correo@gmail.com' });
    await assertFails(setDoc(doc(context.firestore(), 'usuarios', 'correo-externo'), {
      email: 'correo@gmail.com',
      rol: 'pendiente',
      activo: false,
      estado: 'pendiente',
    }));
  });

  it('deniega por defecto colecciones no declaradas', async () => {
    await seedUser('activo-default', { activo: true, rol: 'almacenista' });
    const context = testEnvironment.authenticatedContext('activo-default', { email: 'activo-default@example.com' });
    await assertFails(getDoc(doc(context.firestore(), 'coleccion_no_autorizada', 'documento')));
  });

  it('conserva acceso a subcolecciones operativas anteriores de existencias', async () => {
    await seedUser('subcoleccion-activo', { activo: true, rol: 'almacenista' });
    const context = testEnvironment.authenticatedContext('subcoleccion-activo', { email: 'subcoleccion@example.com' });
    const legacyRef = doc(context.firestore(), 'existencias', 'producto-legacy', 'trazabilidad_anterior', 'registro-1');
    await assertSucceeds(setDoc(legacyRef, { cantidad: 1 }));
    await assertSucceeds(getDoc(legacyRef));
  });

  it('permite registrar y consultar por collectionGroup un lote válido de Agroquímicos', async () => {
    await seedUser('lotes-activo', { activo: true, rol: 'almacenista' });
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'existencias', 'agro-1'), {
        modulo: 'Agroquímicos',
        cantidad: 10,
      });
    });
    const context = testEnvironment.authenticatedContext('lotes-activo', { email: 'lotes@example.com' });
    await assertSucceeds(setDoc(
      doc(context.firestore(), 'existencias', 'agro-1', 'lotes_agroquimicos', 'LOTE-1__2027-01-01'),
      {
        producto_id: 'agro-1',
        numero_lote: 'LOTE-1',
        fecha_vencimiento: '2027-01-01',
        cantidad_inicial: 10,
        cantidad_disponible: 10,
        unidad: 'KG',
      },
    ));
    await assertSucceeds(getDocs(query(collectionGroup(context.firestore(), 'lotes_agroquimicos'))));
    await assertSucceeds(setDoc(
      doc(context.firestore(), 'existencias', 'agro-1', 'lotes_agroquimicos', 'LOTE-MES__2028-02'),
      {
        producto_id: 'agro-1',
        numero_lote: 'LOTE-MES',
        fecha_vencimiento: '2028-02',
        cantidad_inicial: 1,
        cantidad_disponible: 1,
        unidad: 'KG',
      },
    ));
  });

  it('rechaza lotes negativos, mayores a la cantidad inicial o bajo productos de otro módulo', async () => {
    await seedUser('lotes-invalidos', { activo: true, rol: 'almacenista' });
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'existencias', 'agro-2'), { modulo: 'Agroquimicos', cantidad: 5 });
      await setDoc(doc(context.firestore(), 'existencias', 'epp-1'), { modulo: 'EPP', cantidad: 5 });
    });
    const context = testEnvironment.authenticatedContext('lotes-invalidos', { email: 'lotes-invalidos@example.com' });
    const payload = {
      producto_id: 'agro-2',
      numero_lote: 'LOTE-2',
      fecha_vencimiento: '2027-01-01',
      cantidad_inicial: 5,
      cantidad_disponible: 6,
      unidad: 'KG',
    };
    await assertFails(setDoc(
      doc(context.firestore(), 'existencias', 'agro-2', 'lotes_agroquimicos', 'invalido'),
      payload,
    ));
    await assertFails(setDoc(
      doc(context.firestore(), 'existencias', 'epp-1', 'lotes_agroquimicos', 'invalido'),
      { ...payload, producto_id: 'epp-1', cantidad_disponible: 5 },
    ));
  });

  it('protege la identidad y el límite de una asignación de entrada agroquímica', async () => {
    await seedUser('asignaciones-activo', { activo: true, rol: 'almacenista' });
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'existencias', 'agro-3'), { modulo: 'Agroquimicos', cantidad: 8 });
    });
    const context = testEnvironment.authenticatedContext('asignaciones-activo', { email: 'asignaciones@example.com' });
    const assignmentRef = doc(
      context.firestore(),
      'existencias',
      'agro-3',
      'asignaciones_entradas_agroquimicos',
      'entrada-1',
    );
    const payload = {
      entrada_id: 'entrada-1',
      producto_id: 'agro-3',
      cantidad_entrada: 8,
      cantidad_asignada: 3,
    };
    await assertSucceeds(setDoc(assignmentRef, payload));
    await assertSucceeds(setDoc(assignmentRef, { ...payload, cantidad_asignada: 8 }));
    await assertFails(setDoc(assignmentRef, { ...payload, producto_id: 'otro-producto' }));
    await assertFails(setDoc(assignmentRef, { ...payload, cantidad_asignada: 9 }));
  });

  it('la transacción manual no sobrescribe un cambio concurrente', async () => {
    await seedUser('activo', { activo: true, rol: 'almacenista' });
    const openedAt = Timestamp.fromMillis(1_000);
    const changedAt = Timestamp.fromMillis(2_000);
    const initialData = {
      valor_unitario: 1_500,
      modulo: 'EPP',
      codigo: 'EPP-1',
      descripcion: 'Producto',
      actualizado_por: 'equipo-a',
      actualizado_por_uid: 'equipo-a',
      actualizado_en: openedAt,
      origen_actualizacion: 'manual',
    };
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const valuationRef = doc(context.firestore(), 'valoraciones_inventario', 'existencias__producto');
      await setDoc(valuationRef, initialData);
      await setDoc(valuationRef, {
        ...initialData,
        valor_unitario: 1_700,
        actualizado_por: 'equipo-b',
        actualizado_por_uid: 'equipo-b',
        actualizado_en: changedAt,
      });
    });

    const context = testEnvironment.authenticatedContext('activo', { email: 'activo@example.com' });
    await expect(saveManualUnitValuation({
      db: context.firestore() as unknown as Firestore,
      valuationId: 'existencias__producto',
      expectedRevision: valuationRevisionFromData(true, initialData),
      rawValue: '1800',
      moduleName: 'EPP',
      code: 'EPP-1',
      description: 'Producto',
      userLabel: 'activo@example.com',
      userUid: 'activo',
      online: true,
      sourceReady: true,
    })).rejects.toBeInstanceOf(ManualValuationConflictError);

    const current = await getDoc(doc(
      context.firestore(),
      'valoraciones_inventario',
      'existencias__producto',
    ));
    expect(current.data()?.valor_unitario).toBe(1_700);
    expect(current.data()?.actualizado_por_uid).toBe('equipo-b');
  });

  it('una valoración idéntica no genera una escritura duplicada', async () => {
    await seedUser('activo', { activo: true, rol: 'almacenista' });
    const updatedAt = Timestamp.fromMillis(3_000);
    const initialData = {
      valor_unitario: 2_000,
      modulo: 'EPP',
      codigo: 'EPP-2',
      descripcion: 'Producto sin cambio',
      actualizado_por: 'equipo-a',
      actualizado_por_uid: 'equipo-a',
      actualizado_en: updatedAt,
      origen_actualizacion: 'manual',
    };
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'valoraciones_inventario', 'existencias__sin-cambio'),
        initialData,
      );
    });

    const context = testEnvironment.authenticatedContext('activo', { email: 'activo@example.com' });
    const result = await saveManualUnitValuation({
      db: context.firestore() as unknown as Firestore,
      valuationId: 'existencias__sin-cambio',
      expectedRevision: valuationRevisionFromData(true, initialData),
      rawValue: '2000',
      moduleName: 'EPP',
      code: 'EPP-2',
      description: 'Producto sin cambio',
      userLabel: 'activo@example.com',
      userUid: 'activo',
      online: true,
      sourceReady: true,
    });
    const current = await getDoc(doc(
      context.firestore(),
      'valoraciones_inventario',
      'existencias__sin-cambio',
    ));

    expect(result.status).toBe('unchanged');
    expect(current.data()?.actualizado_por_uid).toBe('equipo-a');
    expect(current.data()?.actualizado_en.toMillis()).toBe(updatedAt.toMillis());
  });

  it('crea un documento inexistente aunque el valor inicial sea cero', async () => {
    await seedUser('activo', { activo: true, rol: 'almacenista' });
    const context = testEnvironment.authenticatedContext('activo', { email: 'activo@example.com' });

    const result = await saveManualUnitValuation({
      db: context.firestore() as unknown as Firestore,
      valuationId: 'existencias__valor-cero',
      expectedRevision: emptyValuationRevision(),
      rawValue: '0',
      moduleName: 'EPP',
      code: 'EPP-0',
      description: 'Producto con valor inicial cero',
      userLabel: 'activo@example.com',
      userUid: 'activo',
      online: true,
      sourceReady: true,
    });
    const created = await getDoc(doc(
      context.firestore(),
      'valoraciones_inventario',
      'existencias__valor-cero',
    ));

    expect(result.status).toBe('saved');
    expect(created.exists()).toBe(true);
    expect(created.data()?.valor_unitario).toBe(0);
    expect(created.data()?.actualizado_por_uid).toBe('activo');
    expect(created.data()?.actualizado_en).toBeInstanceOf(Timestamp);
  });
});
