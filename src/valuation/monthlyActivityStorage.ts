import { collection, doc, getDocsFromServer, writeBatch, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { summarizeMonthlyActivity, type MonthlyActivityRow, type MonthlyActivitySnapshot } from './monthlyActivity';

export type MonthlyActivityMetadata = Omit<MonthlyActivitySnapshot, 'rows'> & {
  version: 1;
  movementCount: number;
  estimatedExpense: number;
};

export function monthlyActivityMetadata(snapshot: MonthlyActivitySnapshot): MonthlyActivityMetadata {
  const summary = summarizeMonthlyActivity(snapshot.rows);
  return {
    version: 1, period: snapshot.period, cutoffAt: snapshot.cutoffAt,
    invalidDateCount: snapshot.invalidDateCount, invalidQuantityCount: snapshot.invalidQuantityCount,
    movementCount: summary.movementCount, estimatedExpense: summary.estimatedExpense,
  };
}

function activityCollection(period: string, firestore: Firestore) {
  return collection(firestore, 'cierres_valoracion_inventario', period, 'movimientos');
}

function canonical(row: MonthlyActivityRow) {
  return JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
}

function readRow(value: unknown): MonthlyActivityRow {
  if (!value || typeof value !== 'object') throw new Error('Detalle mensual inválido.');
  const row = value as MonthlyActivityRow;
  const textKeys = ['id', 'occurredAt', 'moduleName', 'productId', 'code', 'product', 'reference', 'unit', 'destinationLot', 'recipientId', 'recipientName', 'priceUnit', 'issue'] as const;
  if (textKeys.some((key) => typeof row[key] !== 'string')
    || !['entry', 'exit'].includes(row.kind)
    || !Number.isFinite(row.quantity) || row.quantity <= 0
    || (row.expense !== null && (!Number.isFinite(row.expense) || row.expense < 0))
    || (row.unitValue !== null && (!Number.isFinite(row.unitValue) || row.unitValue <= 0))) {
    throw new Error('Detalle mensual incompleto o inválido.');
  }
  return row;
}

export async function loadMonthlyActivity(metadata: MonthlyActivityMetadata, firestore = db): Promise<MonthlyActivitySnapshot> {
  const snapshot = await getDocsFromServer(activityCollection(metadata.period, firestore));
  const rows = snapshot.docs.map((record) => {
    const row = readRow(record.data().detalle);
    if (row.id !== record.id) throw new Error('Identidad mensual inconsistente.');
    return row;
  });
  const summary = summarizeMonthlyActivity(rows);
  if (rows.length !== metadata.movementCount || Math.abs(summary.estimatedExpense - metadata.estimatedExpense) > 0.01) {
    throw new Error('El detalle mensual no coincide con el corte guardado.');
  }
  return { ...metadata, rows };
}

// Solo se llama después de reclamar un corte nuevo o un reintento propio en estado error.
export async function saveMonthlyActivity(snapshot: MonthlyActivitySnapshot, attemptId: string, firestore = db) {
  const source = activityCollection(snapshot.period, firestore);
  const existing = await getDocsFromServer(source);
  for (let offset = 0; offset < existing.docs.length; offset += 450) {
    const batch = writeBatch(firestore);
    existing.docs.slice(offset, offset + 450).forEach((record) => batch.delete(record.ref));
    await batch.commit();
  }
  for (let offset = 0; offset < snapshot.rows.length; offset += 450) {
    const batch = writeBatch(firestore);
    snapshot.rows.slice(offset, offset + 450).forEach((row) => {
      batch.set(doc(source, row.id), { intento_id: attemptId, detalle: row });
    });
    await batch.commit();
  }
  const stored = await getDocsFromServer(source);
  const expected = new Map(snapshot.rows.map((row) => [row.id, canonical(row)]));
  if (stored.size !== expected.size || stored.docs.some((record) => (
    record.data().intento_id !== attemptId || canonical(readRow(record.data().detalle)) !== expected.get(record.id)
  ))) throw new Error('No se pudo verificar el detalle de movimientos del corte.');
}
