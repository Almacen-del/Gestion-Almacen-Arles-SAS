import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';

export type ManualValuationRevision = {
  exists: boolean;
  unitValue: number;
  updatedAtMillis: number | null;
  updatedByUid: string;
  updateOrigin: string;
  lastMovementId: string;
};

export type ManualValuationConflict = {
  current: ManualValuationRevision;
};

export type ManualValuationBaselines = Record<string, ManualValuationRevision>;

export type SaveManualValuationResult = {
  status: 'saved' | 'unchanged';
  unitValue: number;
};

export class ManualValuationConflictError extends Error {
  readonly current: ManualValuationRevision;

  constructor(current: ManualValuationRevision) {
    super('La valoración cambió en el servidor desde que se abrió el editor.');
    this.name = 'ManualValuationConflictError';
    this.current = current;
  }
}

export class ManualValuationBlockedError extends Error {
  readonly reason: 'offline' | 'cache' | 'invalid';

  constructor(reason: 'offline' | 'cache' | 'invalid', message: string) {
    super(message);
    this.name = 'ManualValuationBlockedError';
    this.reason = reason;
  }
}

function safeText(data: DocumentData | undefined, key: string) {
  const value = data?.[key];
  return typeof value === 'string' ? value : '';
}

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  if (typeof candidate.toMillis === 'function') {
    const millis = candidate.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof candidate.seconds === 'number') {
    const nanos = typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds : 0;
    return (candidate.seconds * 1_000) + Math.floor(nanos / 1_000_000);
  }
  return null;
}

export function valuationRevisionFromData(
  exists: boolean,
  data?: DocumentData,
): ManualValuationRevision {
  const rawUnitValue = data?.valor_unitario;
  const unitValue = typeof rawUnitValue === 'number' && Number.isFinite(rawUnitValue)
    ? Math.max(rawUnitValue, 0)
    : 0;

  return {
    exists,
    unitValue,
    updatedAtMillis: timestampMillis(data?.actualizado_en),
    updatedByUid: safeText(data, 'actualizado_por_uid'),
    updateOrigin: safeText(data, 'origen_actualizacion'),
    lastMovementId: safeText(data, 'ultimo_movimiento_id'),
  };
}

export function emptyValuationRevision(): ManualValuationRevision {
  return valuationRevisionFromData(false);
}

export function captureValuationBaseline(
  baselines: ManualValuationBaselines,
  valuationId: string,
  latestRevision: ManualValuationRevision,
): ManualValuationBaselines {
  if (baselines[valuationId]) return baselines;
  return { ...baselines, [valuationId]: latestRevision };
}

export function removeValuationBaseline(
  baselines: ManualValuationBaselines,
  valuationId: string,
): ManualValuationBaselines {
  if (!baselines[valuationId]) return baselines;
  const next = { ...baselines };
  delete next[valuationId];
  return next;
}

export function valuationRevisionsMatch(
  expected: ManualValuationRevision,
  current: ManualValuationRevision,
) {
  return expected.exists === current.exists
    && expected.unitValue === current.unitValue
    && expected.updatedAtMillis === current.updatedAtMillis
    && expected.updatedByUid === current.updatedByUid
    && expected.updateOrigin === current.updateOrigin
    && expected.lastMovementId === current.lastMovementId;
}

export function parseManualUnitValue(rawValue: string): number | null {
  if (!rawValue.trim()) return null;
  const value = Number(rawValue.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function saveManualUnitValuation({
  db,
  valuationId,
  expectedRevision,
  rawValue,
  moduleName,
  code,
  description,
  userLabel,
  userUid,
  online,
  sourceReady,
}: {
  db: Firestore;
  valuationId: string;
  expectedRevision: ManualValuationRevision;
  rawValue: string;
  moduleName: string;
  code: string;
  description: string;
  userLabel: string;
  userUid: string;
  online: boolean;
  sourceReady: boolean;
}): Promise<SaveManualValuationResult> {
  if (!online) {
    throw new ManualValuationBlockedError('offline', 'No se puede guardar sin conexión.');
  }
  if (!sourceReady) {
    throw new ManualValuationBlockedError(
      'cache',
      'La valoración debe estar confirmada por el servidor y sin escrituras pendientes.',
    );
  }

  const unitValue = parseManualUnitValue(rawValue);
  if (unitValue === null) {
    throw new ManualValuationBlockedError(
      'invalid',
      'El valor unitario debe ser un número igual o mayor que cero.',
    );
  }

  const valuationRef = doc(db, 'valoraciones_inventario', valuationId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(valuationRef);
    const current = valuationRevisionFromData(snapshot.exists(), snapshot.data());
    if (!valuationRevisionsMatch(expectedRevision, current)) {
      throw new ManualValuationConflictError(current);
    }

    if (current.exists && current.unitValue === unitValue) {
      return { status: 'unchanged', unitValue };
    }

    transaction.set(valuationRef, {
      valor_unitario: unitValue,
      modulo: moduleName,
      codigo: code,
      descripcion: description,
      actualizado_por: userLabel,
      actualizado_por_uid: userUid,
      actualizado_en: serverTimestamp(),
      origen_actualizacion: 'manual',
    }, { merge: true });

    return { status: 'saved', unitValue };
  });
}
