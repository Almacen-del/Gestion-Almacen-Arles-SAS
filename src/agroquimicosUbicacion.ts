import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { AGROQUIMICOS_UBICACIONES, type AgroquimicosUbicacion } from './agroquimicosCanonicos';

export async function saveAgrochemicalLocation(options: {
  db: Firestore;
  productId: string;
  expectedLocation: string;
  location: AgroquimicosUbicacion;
  online: boolean;
  sourceReady: boolean;
}) {
  const { db, productId, expectedLocation, location, online, sourceReady } = options;
  if (!online) throw new Error('Conéctate a internet para cambiar la ubicación.');
  if (!sourceReady) throw new Error('Espera a que el inventario se sincronice con Firestore.');
  if (!productId.trim() || productId.includes('/')) throw new Error('El producto no tiene un identificador válido.');
  if (!AGROQUIMICOS_UBICACIONES.includes(location)) throw new Error('Selecciona una ubicación válida.');

  // El ID identifica esta existencia, aunque contenga el nombre de su ubicación anterior.
  const productRef = doc(db, 'existencias', productId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(productRef);
    if (!snapshot.exists()) throw new Error('El producto ya no existe. Actualiza el inventario.');
    const data = snapshot.data();
    const module = String(data.modulo ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    if (!module.includes('agroquimico')) throw new Error('Solo se puede editar la ubicación de agroquímicos.');
    const currentLocation = String(data.ubicacion ?? '').trim();
    if (currentLocation === location) return location;
    if (currentLocation !== expectedLocation.trim()) {
      throw new Error('La ubicación cambió desde otro equipo. Revisa el valor actualizado e inténtalo de nuevo.');
    }
    // No renombrar documentos ni modificar códigos, cantidades, movimientos o lotes.
    transaction.update(productRef, { ubicacion: location });
    return location;
  });
}

export function locationSaveErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  if (code === 'permission-denied') return 'Tu cuenta no tiene permiso para cambiar la ubicación.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'No se pudo confirmar el cambio. Revisa la conexión y la ubicación actual antes de reintentar.';
  return error instanceof Error ? error.message : 'No se pudo guardar la ubicación. Inténtalo de nuevo.';
}
