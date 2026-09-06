import { getFunctions, httpsCallable } from 'firebase/functions';
import type { FirebaseApp } from 'firebase/app';
import type { AgrochemicalLotRegistration } from './agrochemicalRegistration';

export async function registerAgrochemicalLotOnServer(app: FirebaseApp, registration: AgrochemicalLotRegistration) {
  const register = httpsCallable<AgrochemicalLotRegistration, {
    operationId: string; productDocumentId: string; lotId: string;
    quantityAdded: number; quantityLinked: number; replayed: boolean;
  }>(getFunctions(app, 'us-central1'), 'registrarLoteAgroquimico', { timeout: 70_000 });
  const result = await register(registration);
  if (result.data.operationId !== registration.operationId || result.data.productDocumentId !== registration.productDocumentId) {
    throw new Error('No se pudo confirmar el comprobante de asignación. Reintenta la misma operación.');
  }
  // Deliberately no fallback to direct Firestore writes on an old deployment.
}
