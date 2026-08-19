export const STOCK_COMPARISON_TOLERANCE = 1e-6;

export type EntryStockNumbers = {
  quantity: number;
  previousStock: number;
  newStock: number;
};

export type ChronologicalEntry = {
  id: string;
  productKey: string;
  createdAtMs: number | null;
};

export type SequencedEntry<T extends ChronologicalEntry> = T & {
  alreadyValued: boolean;
  priorMovementIds: string[];
  blockedByMovementId: string | null;
};

export class InvalidEntryValuationDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEntryValuationDataError';
  }
}

export class MissingBaseAverageError extends Error {
  constructor() {
    super('El producto tiene stock anterior, pero no existe un promedio base.');
    this.name = 'MissingBaseAverageError';
  }
}

export class DuplicateEntryValuationError extends Error {
  constructor(movementId: string) {
    super(`El movimiento ${movementId} ya fue valorado.`);
    this.name = 'DuplicateEntryValuationError';
  }
}

export class PreviousEntryPendingError extends Error {
  constructor(movementId: string) {
    super(`Primero valora la entrada anterior ${movementId}.`);
    this.name = 'PreviousEntryPendingError';
  }
}

function normalizedModule(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

export function inventoryValuationIdForEntry(moduleName: string, productId: string) {
  if (/^(existencias|productos_aseo|herramientas)__/.test(productId)) return productId;
  const module = normalizedModule(moduleName);
  const source = module === 'aseo'
    ? 'productos_aseo'
    : module === 'taller' || module.includes('herramienta')
      ? 'herramientas'
      : 'existencias';
  return `${source}__${encodeURIComponent(productId)}`;
}

function requireFiniteNonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidEntryValuationDataError(`${field} debe ser un número no negativo.`);
  }
}

export function stocksAreConsistent(
  { quantity, previousStock, newStock }: EntryStockNumbers,
  tolerance = STOCK_COMPARISON_TOLERANCE,
) {
  if (![quantity, previousStock, newStock].every(Number.isFinite)) return false;
  const expected = previousStock + quantity;
  const scale = Math.max(1, Math.abs(expected), Math.abs(newStock));
  return Math.abs(newStock - expected) <= tolerance * scale;
}

export function validateEntryStockNumbers(stock: EntryStockNumbers) {
  requireFiniteNonNegative(stock.previousStock, 'stock_anterior');
  requireFiniteNonNegative(stock.newStock, 'stock_nuevo');
  if (!Number.isFinite(stock.quantity) || stock.quantity <= 0) {
    throw new InvalidEntryValuationDataError('cantidad_entrada debe ser mayor que cero.');
  }
  if (!stocksAreConsistent(stock)) {
    throw new InvalidEntryValuationDataError(
      'El stock nuevo no coincide con stock_anterior + cantidad_entrada.',
    );
  }
}

export function calculateWeightedAverage({
  quantity,
  previousStock,
  newStock,
  entryUnitValue,
  previousAverage,
}: EntryStockNumbers & {
  entryUnitValue: number;
  previousAverage: number | null;
}) {
  validateEntryStockNumbers({ quantity, previousStock, newStock });
  requireFiniteNonNegative(entryUnitValue, 'valor_unitario_entrada');

  if (previousStock === 0) return entryUnitValue;
  if (previousAverage === null) throw new MissingBaseAverageError();
  requireFiniteNonNegative(previousAverage, 'promedio_anterior');

  return (
    (previousStock * previousAverage)
    + (quantity * entryUnitValue)
  ) / newStock;
}

function chronologicalTime(value: number | null) {
  return value !== null && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function compareEntryChronology(left: ChronologicalEntry, right: ChronologicalEntry) {
  return chronologicalTime(left.createdAtMs) - chronologicalTime(right.createdAtMs)
    || left.id.localeCompare(right.id);
}

export function sequenceEntryValuations<T extends ChronologicalEntry>(
  entries: T[],
  valuedMovementIds: ReadonlySet<string>,
): SequencedEntry<T>[] {
  const priorByProduct = new Map<string, string[]>();

  return [...entries].sort(compareEntryChronology).map((entry) => {
    const priorMovementIds = [...(priorByProduct.get(entry.productKey) ?? [])];
    const alreadyValued = valuedMovementIds.has(entry.id);
    const blockedByMovementId = alreadyValued
      ? null
      : priorMovementIds.find((movementId) => !valuedMovementIds.has(movementId)) ?? null;
    priorByProduct.set(entry.productKey, [...priorMovementIds, entry.id]);
    return { ...entry, alreadyValued, priorMovementIds, blockedByMovementId };
  });
}

export function assertEntryNotValued(
  movementId: string,
  valuedMovementIds: ReadonlySet<string>,
) {
  if (valuedMovementIds.has(movementId)) {
    throw new DuplicateEntryValuationError(movementId);
  }
}
