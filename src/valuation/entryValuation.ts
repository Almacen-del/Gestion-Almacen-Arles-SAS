import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { isExcludedEntryStockMovement } from './entryMovementScope';
import {
  calculateWeightedAverage,
  DuplicateEntryValuationError,
  inventoryValuationIdForEntry,
  InvalidEntryValuationDataError,
  PreviousEntryPendingError,
  validateEntryStockNumbers,
} from './entryValuationMath';

const MOVEMENTS_COLLECTION = 'movimientos';
const ENTRY_VALUATIONS_COLLECTION = 'valoraciones_entradas';
const INVENTORY_VALUATIONS_COLLECTION = 'valoraciones_inventario';

export type EntryStockMovement = {
  id: string;
  productKey: string;
  productId: string;
  valuationId: string;
  moduleName: string;
  code: string;
  product: string;
  reference: string;
  unit: string;
  dateLabel: string;
  createdAt: Date | null;
  createdAtMs: number | null;
  quantity: number;
  previousStock: number;
  newStock: number;
  validationIssue: string;
};

export type EntryValuationRecord = {
  movementId: string;
  entryUnitValue: number;
  previousAverage: number;
  newAverage: number;
  valuedAt: Date | null;
};

export type RealtimeSnapshotMetadata = {
  fromCache: boolean;
  hasPendingWrites: boolean;
};

export type SaveEntryValuationResult = {
  previousAverage: number;
  newAverage: number;
};

function textValue(data: DocumentData, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numericValue(data: DocumentData, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return Number.NaN;
}

function timestampValue(value: unknown) {
  return value instanceof Timestamp ? value : null;
}

function parseEntryMovement(id: string, data: DocumentData): EntryStockMovement | null {
  if (data.clase_movimiento !== 'entrada_stock' || isExcludedEntryStockMovement(data)) return null;

  const moduleName = textValue(data, 'modulo') || 'Sin módulo';
  const productId = textValue(data, 'producto_id', 'documento_id');
  const createdTimestamp = timestampValue(data.creado_en);
  const quantity = numericValue(data, 'cantidad', 'cantidad_entrada', 'cantidadNumerica');
  const previousStock = numericValue(data, 'stock_anterior');
  const newStock = numericValue(data, 'stock_nuevo');
  let validationIssue = '';

  if (!productId) {
    validationIssue = 'El movimiento no tiene producto_id ni documento_id.';
  } else if (!createdTimestamp) {
    validationIssue = 'El movimiento no tiene creado_en válido.';
  } else {
    try {
      validateEntryStockNumbers({ quantity, previousStock, newStock });
    } catch (error) {
      validationIssue = error instanceof Error ? error.message : 'Los datos de stock son inválidos.';
    }
  }

  const fallbackDate = textValue(data, 'fecha', 'fechaRegistro');
  return {
    id,
    productKey: productId || `invalido:${id}`,
    productId,
    valuationId: productId ? inventoryValuationIdForEntry(moduleName, productId) : '',
    moduleName,
    code: textValue(data, 'codigo', 'codigo_interno', 'codigoInterno', 'codigo_original') || productId || 'N/A',
    product: textValue(data, 'item', 'producto', 'nombre') || 'Producto sin nombre',
    reference: textValue(data, 'referencia', 'ref') || 'N/A',
    unit: textValue(data, 'unidad') || 'Unidad',
    dateLabel: createdTimestamp?.toDate().toLocaleString('es-CO') || fallbackDate || 'Sin fecha',
    createdAt: createdTimestamp?.toDate() ?? null,
    createdAtMs: createdTimestamp?.toMillis() ?? null,
    quantity,
    previousStock,
    newStock,
    validationIssue,
  };
}

export function subscribeEntryStockMovements(
  onData: (entries: EntryStockMovement[], metadata: RealtimeSnapshotMetadata) => void,
  onError: (error: Error) => void,
) {
  const markedEntries = query(
    collection(db, MOVEMENTS_COLLECTION),
    where('clase_movimiento', '==', 'entrada_stock'),
  );
  return onSnapshot(
    markedEntries,
    { includeMetadataChanges: true },
    (snapshot) => onData(
      snapshot.docs.flatMap((movementDoc) => {
        const movement = parseEntryMovement(movementDoc.id, movementDoc.data());
        return movement ? [movement] : [];
      }),
      {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      },
    ),
    (error) => onError(error),
  );
}

export function subscribeEntryValuationRecords(
  onData: (
    records: Record<string, EntryValuationRecord>,
    metadata: RealtimeSnapshotMetadata,
  ) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    collection(db, ENTRY_VALUATIONS_COLLECTION),
    { includeMetadataChanges: true },
    (snapshot) => onData(
      Object.fromEntries(snapshot.docs.map((recordDoc) => {
        const data = recordDoc.data();
        const valuedAt = timestampValue(data.valorado_en);
        return [recordDoc.id, {
          movementId: recordDoc.id,
          entryUnitValue: numericValue(data, 'valor_unitario_entrada'),
          previousAverage: numericValue(data, 'promedio_anterior'),
          newAverage: numericValue(data, 'promedio_nuevo'),
          valuedAt: valuedAt?.toDate() ?? null,
        } satisfies EntryValuationRecord];
      })),
      {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      },
    ),
    (error) => onError(error),
  );
}

export async function saveEntryValuation({
  movementId,
  priorMovementIds,
  entryUnitValue,
  user,
}: {
  movementId: string;
  priorMovementIds: string[];
  entryUnitValue: number;
  user: User;
}): Promise<SaveEntryValuationResult> {
  const movementRef = doc(db, MOVEMENTS_COLLECTION, movementId);
  const entryValuationRef = doc(db, ENTRY_VALUATIONS_COLLECTION, movementId);

  return runTransaction(db, async (transaction) => {
    const existingEntryValuation = await transaction.get(entryValuationRef);
    if (existingEntryValuation.exists()) throw new DuplicateEntryValuationError(movementId);

    for (const priorMovementId of priorMovementIds) {
      const priorValuation = await transaction.get(doc(db, ENTRY_VALUATIONS_COLLECTION, priorMovementId));
      if (!priorValuation.exists()) throw new PreviousEntryPendingError(priorMovementId);
    }

    const movementSnapshot = await transaction.get(movementRef);
    if (!movementSnapshot.exists()) {
      throw new InvalidEntryValuationDataError('El movimiento ya no existe.');
    }
    const movement = parseEntryMovement(movementSnapshot.id, movementSnapshot.data());
    if (!movement) {
      throw new InvalidEntryValuationDataError('El movimiento no es una entrada_stock valorable.');
    }
    if (movement.validationIssue) throw new InvalidEntryValuationDataError(movement.validationIssue);

    const inventoryValuationRef = doc(db, INVENTORY_VALUATIONS_COLLECTION, movement.valuationId);
    const inventoryValuation = await transaction.get(inventoryValuationRef);
    const previousAverage = inventoryValuation.exists()
      ? numericValue(inventoryValuation.data(), 'valor_unitario')
      : null;
    if (inventoryValuation.exists() && (!Number.isFinite(previousAverage) || previousAverage! < 0)) {
      throw new InvalidEntryValuationDataError('El promedio vigente del producto es inválido.');
    }

    const newAverage = calculateWeightedAverage({
      quantity: movement.quantity,
      previousStock: movement.previousStock,
      newStock: movement.newStock,
      entryUnitValue,
      previousAverage,
    });
    const effectivePreviousAverage = movement.previousStock === 0 ? 0 : previousAverage ?? 0;
    const userLabel = user.email || user.displayName || user.uid;
    const movementCreatedAt = movementSnapshot.data().creado_en;
    if (!(movementCreatedAt instanceof Timestamp)) {
      throw new InvalidEntryValuationDataError('El movimiento no tiene creado_en válido.');
    }

    transaction.set(inventoryValuationRef, {
      valor_unitario: newAverage,
      modulo: movement.moduleName,
      codigo: movement.code,
      descripcion: movement.product,
      actualizado_por: userLabel,
      actualizado_por_uid: user.uid,
      actualizado_en: serverTimestamp(),
      origen_actualizacion: 'entrada_stock',
      ultimo_movimiento_id: movement.id,
    }, { merge: true });
    transaction.set(entryValuationRef, {
      movimiento_id: movement.id,
      producto_id: movement.productId,
      valoracion_id: movement.valuationId,
      modulo: movement.moduleName,
      codigo: movement.code,
      producto: movement.product,
      referencia: movement.reference,
      cantidad: movement.quantity,
      stock_anterior: movement.previousStock,
      stock_nuevo: movement.newStock,
      valor_unitario_entrada: entryUnitValue,
      promedio_anterior: effectivePreviousAverage,
      promedio_nuevo: newAverage,
      usuario: userLabel,
      usuario_uid: user.uid,
      movimiento_creado_en: movementCreatedAt,
      valorado_en: serverTimestamp(),
    });

    return { previousAverage: effectivePreviousAverage, newAverage };
  });
}

export {
  DuplicateEntryValuationError,
  InvalidEntryValuationDataError,
  PreviousEntryPendingError,
};
