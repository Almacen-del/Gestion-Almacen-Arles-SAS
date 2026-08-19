import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import { summarizeCurrentValuation } from './currentValuation';
import {
  buildExpectedMonthlyCloseIntegrity,
  verifyMonthlyCloseItems,
} from './monthlyCloseIntegrity';
import {
  assertCurrentBogotaPeriod,
  currentBogotaPeriod,
  isEarlyCloseConfirmationValid,
  isLastBogotaDayOfMonth,
} from './monthlyCloseSafety';
import type { CurrentValuationRow, MonthlyValuationItem, MonthlyValuationSummary } from './models';

const MONTHLY_CLOSES_COLLECTION = 'cierres_valoracion_inventario';
const FIRESTORE_SAFE_BATCH_SIZE = 450;
export const MONTHLY_SUMMARY_PAGE_SIZE = 12;

export class DuplicateMonthlyCloseError extends Error {
  constructor(period: string) {
    super(`Ya existe un corte completo para ${period}.`);
    this.name = 'DuplicateMonthlyCloseError';
  }
}

export class MonthlyCloseInProgressError extends Error {
  constructor(period: string) {
    super(`El corte ${period} ya se está guardando.`);
    this.name = 'MonthlyCloseInProgressError';
  }
}

export class MonthlyCloseRetryNotAllowedError extends Error {
  constructor(period: string) {
    super(`El corte fallido ${period} solo puede ser reintentado por su creador.`);
    this.name = 'MonthlyCloseRetryNotAllowedError';
  }
}

export class MonthlyCloseVerificationError extends Error {
  constructor() {
    super('La verificación final de IDs, cantidad de ítems y suma total no coincidió.');
    this.name = 'MonthlyCloseVerificationError';
  }
}

export class EarlyMonthlyCloseConfirmationError extends Error {
  constructor(period: string) {
    super(`Debes escribir CERRAR ${period} para cerrar antes del último día del mes.`);
    this.name = 'EarlyMonthlyCloseConfirmationError';
  }
}

export type MonthlySnapshotMetadata = {
  fromCache: boolean;
  hasPendingWrites: boolean;
};

export function currentValuationPeriod(date = new Date()) {
  return currentBogotaPeriod(date);
}

export function formatValuationPeriod(period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function chunkArray<T>(items: T[]) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += FIRESTORE_SAFE_BATCH_SIZE) {
    chunks.push(items.slice(index, index + FIRESTORE_SAFE_BATCH_SIZE));
  }
  return chunks;
}

function toDate(value: unknown) {
  return value instanceof Timestamp ? value.toDate() : null;
}

function readMonthlySummary(period: string, data: Record<string, unknown>): MonthlyValuationSummary {
  const summary = data.resumen && typeof data.resumen === 'object'
    ? data.resumen as Record<string, unknown>
    : {};
  const moduleTotals = summary.totales_modulo && typeof summary.totales_modulo === 'object'
    ? summary.totales_modulo as Record<string, number>
    : {};
  const status = data.estado === 'guardando' || data.estado === 'error' ? data.estado : 'completo';

  return {
    period,
    totalValue: Number(summary.valor_total) || 0,
    productCount: Number(summary.cantidad_productos) || 0,
    valuedProductCount: Number(summary.productos_con_valor) || 0,
    unvaluedProductCount: Number(summary.productos_sin_valor) || 0,
    valuedPercentage: Number(summary.porcentaje_valorado) || 0,
    moduleTotals,
    createdAt: toDate(data.fecha),
    createdBy: typeof data.usuario === 'string' ? data.usuario : '',
    createdByUid: typeof data.usuario_uid === 'string' ? data.usuario_uid : '',
    status,
  };
}

export function subscribeMonthlyValuationPeriod(
  period: string,
  onData: (summary: MonthlyValuationSummary | null) => void,
  onError: (error: Error) => void,
  onMetadata?: (metadata: MonthlySnapshotMetadata) => void,
) {
  return onSnapshot(
    doc(db, MONTHLY_CLOSES_COLLECTION, period),
    { includeMetadataChanges: true },
    (snapshot) => {
      onData(snapshot.exists() ? readMonthlySummary(snapshot.id, snapshot.data()) : null);
      onMetadata?.({
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => onError(error),
  );
}

export type MonthlyValuationSummaryPage = {
  summaries: MonthlyValuationSummary[];
  cursor: string | null;
  hasMore: boolean;
};

export async function loadMonthlyValuationSummaryPage(
  cursor: string | null = null,
  pageSize = MONTHLY_SUMMARY_PAGE_SIZE,
): Promise<MonthlyValuationSummaryPage> {
  const source = collection(db, MONTHLY_CLOSES_COLLECTION);
  const pageQuery = cursor
    ? query(source, orderBy(documentId(), 'desc'), startAfter(cursor), firestoreLimit(pageSize))
    : query(source, orderBy(documentId(), 'desc'), firestoreLimit(pageSize));
  const snapshot = await getDocs(pageQuery);
  const summaries = snapshot.docs
    .map((snapshotDoc) => readMonthlySummary(snapshotDoc.id, snapshotDoc.data()))
    .filter((summary) => summary.status === 'completo');
  return {
    summaries,
    cursor: snapshot.docs.at(-1)?.id ?? cursor,
    hasMore: snapshot.size === pageSize,
  };
}

export function mergeMonthlyValuationSummaryPages(
  current: readonly MonthlyValuationSummary[],
  incoming: readonly MonthlyValuationSummary[],
) {
  const byPeriod = new Map(current.map((summary) => [summary.period, summary]));
  incoming.forEach((summary) => byPeriod.set(summary.period, summary));
  return [...byPeriod.values()].sort((left, right) => right.period.localeCompare(left.period));
}

export async function loadMonthlyValuationItems(period: string): Promise<MonthlyValuationItem[]> {
  const snapshot = await getDocs(collection(db, MONTHLY_CLOSES_COLLECTION, period, 'items'));
  return snapshot.docs.map((itemDoc) => {
    const data = itemDoc.data();
    return {
      id: itemDoc.id,
      moduleName: typeof data.modulo === 'string' ? data.modulo : 'Sin módulo',
      code: typeof data.codigo === 'string' ? data.codigo : '',
      reference: typeof data.referencia === 'string' && data.referencia.trim() ? data.referencia : 'N/A',
      product: typeof data.producto === 'string' ? data.producto : '',
      quantity: Number(data.cantidad) || 0,
      unit: typeof data.unidad === 'string' ? data.unidad : '',
      unitValue: Number(data.valor_unitario) || 0,
      totalValue: Number(data.valor_total) || 0,
    };
  }).sort((left, right) => (
    left.moduleName.localeCompare(right.moduleName)
    || left.code.localeCompare(right.code, undefined, { numeric: true })
    || left.product.localeCompare(right.product)
  ));
}

function createAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function clearMonthlyCloseItems(period: string) {
  const itemsRef = collection(db, MONTHLY_CLOSES_COLLECTION, period, 'items');
  const snapshot = await getDocsFromServer(itemsRef);
  for (const documents of chunkArray(snapshot.docs)) {
    const batch = writeBatch(db);
    documents.forEach((snapshotDoc) => batch.delete(snapshotDoc.ref));
    await batch.commit();
  }
}

async function markMonthlyCloseError(
  period: string,
  userUid: string,
  attemptId: string,
) {
  const closeRef = doc(db, MONTHLY_CLOSES_COLLECTION, period);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(closeRef);
    if (
      snapshot.exists()
      && snapshot.data().estado === 'guardando'
      && snapshot.data().usuario_uid === userUid
      && snapshot.data().intento_id === attemptId
    ) {
      transaction.update(closeRef, { estado: 'error' });
    }
  });
}

export async function saveMonthlyValuationClose({
  period,
  rows,
  moduleOptions,
  user,
  earlyConfirmation,
  onProgress,
}: {
  period: string;
  rows: CurrentValuationRow[];
  moduleOptions: string[];
  user: User;
  earlyConfirmation: string;
  onProgress: (completedSteps: number, totalSteps: number) => void;
}) {
  const requestedAt = new Date();
  assertCurrentBogotaPeriod(period, requestedAt);
  if (
    !isLastBogotaDayOfMonth(requestedAt)
    && !isEarlyCloseConfirmationValid(earlyConfirmation, `CERRAR ${period}`)
  ) {
    throw new EarlyMonthlyCloseConfirmationError(period);
  }
  const integrity = buildExpectedMonthlyCloseIntegrity(rows);
  const summary = summarizeCurrentValuation(rows, moduleOptions);
  const chunks = chunkArray(rows);
  const totalSteps = chunks.length + 4;
  const closeRef = doc(db, MONTHLY_CLOSES_COLLECTION, period);
  const userLabel = user.email || user.displayName || user.uid;
  const attemptId = createAttemptId();
  const summaryPayload = {
    valor_total: summary.inventoryGrandTotal,
    cantidad_productos: summary.productCount,
    productos_con_valor: summary.valuedProductCount,
    productos_sin_valor: summary.unvaluedProductCount,
    porcentaje_valorado: summary.valuedPercentage,
    totales_modulo: Object.fromEntries(summary.moduleTotals.map((entry) => [entry.moduleName, entry.total])),
  };
  let claimed = false;
  let completed = false;

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(closeRef);
    if (existing.exists()) {
      const status = existing.data().estado;
      if (status === 'completo') throw new DuplicateMonthlyCloseError(period);
      if (status === 'guardando') throw new MonthlyCloseInProgressError(period);
      if (status !== 'error' || existing.data().usuario_uid !== user.uid) {
        throw new MonthlyCloseRetryNotAllowedError(period);
      }
    }

    transaction.set(closeRef, {
      periodo: period,
      resumen: summaryPayload,
      fecha: serverTimestamp(),
      usuario: userLabel,
      usuario_uid: user.uid,
      estado: 'guardando',
      intento_id: attemptId,
      verificacion: {
        cantidad_items: 0,
        suma_total: 0,
        ids_hash: '',
        verificado: false,
      },
    });
  });
  claimed = true;
  onProgress(1, totalSteps);

  try {
    await clearMonthlyCloseItems(period);
    onProgress(2, totalSteps);

    for (let index = 0; index < chunks.length; index += 1) {
      const batch = writeBatch(db);
      chunks[index].forEach((row) => {
        const itemRef = doc(db, MONTHLY_CLOSES_COLLECTION, period, 'items', row.valuationId);
        batch.set(itemRef, {
          item_id: row.valuationId,
          intento_id: attemptId,
          modulo: row.moduleName,
          codigo: row.code,
          referencia: row.reference || 'N/A',
          producto: row.product,
          cantidad: row.quantity,
          unidad: row.unit,
          valor_unitario: row.unitValue,
          valor_total: row.totalValue,
        });
      });
      await batch.commit();
      onProgress(index + 3, totalSteps);
    }

    const storedSnapshot = await getDocsFromServer(
      collection(db, MONTHLY_CLOSES_COLLECTION, period, 'items'),
    );
    const allItemsFromAttempt = storedSnapshot.docs.every(
      (snapshotDoc) => snapshotDoc.data().intento_id === attemptId,
    );
    const verification = verifyMonthlyCloseItems(
      integrity,
      storedSnapshot.docs.map((snapshotDoc) => ({
        id: snapshotDoc.id,
        totalValue: Number(snapshotDoc.data().valor_total),
      })),
    );
    if (!allItemsFromAttempt || !verification.valid) throw new MonthlyCloseVerificationError();
    onProgress(chunks.length + 3, totalSteps);

    await runTransaction(db, async (transaction) => {
      const current = await transaction.get(closeRef);
      if (
        !current.exists()
        || current.data().estado !== 'guardando'
        || current.data().usuario_uid !== user.uid
        || current.data().intento_id !== attemptId
      ) {
        throw new MonthlyCloseInProgressError(period);
      }
      transaction.update(closeRef, {
        estado: 'completo',
        fecha: serverTimestamp(),
        verificacion: {
          cantidad_items: verification.actual.itemCount,
          suma_total: verification.actual.totalValue,
          ids_hash: verification.actual.idsHash,
          verificado: true,
        },
      });
    });
    completed = true;
    onProgress(totalSteps, totalSteps);

    let completedAt: Date | null = null;
    try {
      const completedSnapshot = await getDocFromServer(closeRef);
      completedAt = toDate(completedSnapshot.data()?.fecha);
    } catch (readError) {
      console.error('El corte se completó, pero no se pudo releer su fecha del servidor:', readError);
    }
    return {
      completedAt,
      itemCount: verification.actual.itemCount,
      totalValue: verification.actual.totalValue,
    };
  } catch (error) {
    if (claimed && !completed) {
      try {
        await markMonthlyCloseError(period, user.uid, attemptId);
      } catch (statusError) {
        console.error('No se pudo marcar el corte mensual como fallido:', statusError);
      }
    }
    throw error;
  }
}
