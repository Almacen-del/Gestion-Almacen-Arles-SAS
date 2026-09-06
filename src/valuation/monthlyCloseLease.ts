import { doc, runTransaction, serverTimestamp, Timestamp, type Firestore, type Transaction } from 'firebase/firestore';
import { db } from '../firebase';

// Server rules use the same 15-minute window. Browser time is only a UX hint;
// request.time and serverTimestamp are authoritative for every write.
export const MONTHLY_CLOSE_LEASE_MS = 15 * 60 * 1000;
export const MONTHLY_CLOSE_PROTOCOL = 2;
export const CLOSE_COLLECTION = 'cierres_valoracion_inventario';

export function closeLastProgress(data: Record<string, unknown>): Date | null {
  const value = data.protocolo_cierre === MONTHLY_CLOSE_PROTOCOL ? data.pulso : data.fecha;
  return value instanceof Timestamp ? value.toDate() : null;
}

export function isCloseLeaseExpired(lastProgress: Date | null, now = new Date()) {
  return !!lastProgress && Number.isFinite(lastProgress.getTime())
    && now.getTime() >= lastProgress.getTime() + MONTHLY_CLOSE_LEASE_MS;
}

export function assertCloseAttempt(data: Record<string, unknown> | undefined, attemptId: string) {
  if (!data || data.estado !== 'guardando' || data.intento_id !== attemptId
    || data.protocolo_cierre !== MONTHLY_CLOSE_PROTOCOL) {
    throw new Error('El intento de cierre ya no está activo. Actualiza los datos antes de reintentar.');
  }
}

// The parent pulse and all detail changes commit atomically. A delayed writer,
// including a delete from an old tab under the SAME uid, cannot cross attempts.
export async function commitMonthlyCloseChunk(
  period: string, attemptId: string, write: (transaction: Transaction) => void, firestore: Firestore = db,
) {
  const parent = doc(firestore, CLOSE_COLLECTION, period);
  await runTransaction(firestore, async (transaction) => {
    const current = await transaction.get(parent);
    assertCloseAttempt(current.data(), attemptId);
    transaction.update(parent, { pulso: serverTimestamp() });
    write(transaction);
  });
}

export async function recoverAbandonedMonthlyClose({ period, attemptId, userUid, confirmation, firestore = db }: {
  period: string; attemptId: string; userUid: string; confirmation: string; firestore?: Firestore;
}) {
  if (confirmation.trim() !== `RECUPERAR ${period}`) throw new Error(`Escribe RECUPERAR ${period}.`);
  const parent = doc(firestore, CLOSE_COLLECTION, period);
  await runTransaction(firestore, async (transaction) => {
    const current = await transaction.get(parent);
    const before = current.data();
    if (!before || before.estado !== 'guardando' || before.intento_id !== attemptId) {
      throw new Error('El cierre cambió o ya terminó. Actualiza los datos; no se recuperó otro intento.');
    }
    if (!isCloseLeaseExpired(closeLastProgress(before))) {
      throw new Error('El cierre sigue activo o no tiene una fecha verificable. No se puede recuperar.');
    }
    const recovery = {
      intento_id: attemptId, por_uid: userUid, fecha: serverTimestamp(),
      usuario_original: before.usuario_uid,
      ultimo_pulso: before.protocolo_cierre === MONTHLY_CLOSE_PROTOCOL ? before.pulso : before.fecha,
    };
    transaction.update(parent, { estado: 'error', recuperacion: recovery });
    transaction.set(doc(parent, 'recuperaciones', attemptId), recovery);
  });
}
