export type AgrochemicalLotRegistration = {
  operationId: string;
  productDocumentId: string;
  existingLotId?: string;
  lotNumber: string;
  expirationDate: string;
  quantity: number;
  receivedAt: string;
  sourceEntryId?: string;
  linkExistingLotWithoutStockIncrease: boolean;
};

export type LotRegistrationIntent = Omit<AgrochemicalLotRegistration, 'operationId'>;
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const lotAttemptKey = (scope: string) => `arles:lot-registration:v2:${scope}`;

// Collection-group reads may also return legacy subcollections with the same
// name. Only the canonical product path can participate in inventory totals.
export function isCanonicalAgrochemicalLotPath(path: string) {
  return /^existencias\/[^/]+\/lotes_agroquimicos\/[^/]+$/.test(path);
}

export function readLotAttempt(storage: AttemptStorage, scope: string): AgrochemicalLotRegistration | null {
  const raw = storage.getItem(lotAttemptKey(scope));
  if (!raw) return null;
  const data = JSON.parse(raw) as AgrochemicalLotRegistration;
  if (!data || typeof data.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(data.operationId)
    || typeof data.productDocumentId !== 'string' || typeof data.lotNumber !== 'string'
    || typeof data.expirationDate !== 'string' || typeof data.receivedAt !== 'string'
    || typeof data.linkExistingLotWithoutStockIncrease !== 'boolean'
    || !Number.isFinite(data.quantity) || data.quantity <= 0) {
    throw new Error('El comprobante local de asignación requiere revisión. No se enviaron nuevos datos.');
  }
  return data;
}

export function prepareLotAttempt(storage: AttemptStorage, scope: string, intent: LotRegistrationIntent,
  createId: () => string = () => crypto.randomUUID()): AgrochemicalLotRegistration {
  const pending = readLotAttempt(storage, scope);
  if (pending) throw new Error('Primero comprueba la asignación pendiente con el botón de reintento.');
  const attempt = { ...intent, operationId: createId() };
  // Persist BEFORE any request. Reloading or closing the modal cannot create a
  // different operation for a request whose acknowledgement was lost.
  storage.setItem(lotAttemptKey(scope), JSON.stringify(attempt));
  return attempt;
}

export function clearLotAttempt(storage: AttemptStorage, scope: string, operationId: string) {
  if (readLotAttempt(storage, scope)?.operationId === operationId) storage.removeItem(lotAttemptKey(scope));
}

// Only explicit, atomic server rejections are safe to release. Network errors,
// timeouts, internal errors and lost responses keep the request for replay.
export function isDefinitiveLotRejection(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && [
    'functions/invalid-argument', 'functions/permission-denied', 'functions/unauthenticated',
    'functions/not-found', 'functions/failed-precondition',
  ].includes(code);
}
