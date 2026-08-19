export type TallerStatusOrder = 'default' | 'good-first' | 'maintenance-first';

export type TallerStatusState = {
  overrides: Record<string, string>;
  pending: Record<string, string>;
  awaitingConfirmation: Record<string, string>;
  errors: Record<string, string>;
};

export type SortableTallerItem = {
  id: string;
  codigo: string;
  descripcion: string;
  estado?: string;
};

export function createInitialTallerStatusState(): TallerStatusState {
  return {
    overrides: {},
    pending: {},
    awaitingConfirmation: {},
    errors: {},
  };
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function normalizedStatus(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

export function isTallerStatusBusy(state: TallerStatusState, itemId: string) {
  return Boolean(state.pending[itemId] || state.awaitingConfirmation[itemId]);
}

export function beginTallerStatusUpdate(
  state: TallerStatusState,
  itemId: string,
  nextStatus: string,
) {
  if (isTallerStatusBusy(state, itemId)) return state;
  return {
    ...state,
    overrides: { ...state.overrides, [itemId]: nextStatus },
    pending: { ...state.pending, [itemId]: nextStatus },
    errors: withoutKey(state.errors, itemId),
  };
}

export function markTallerStatusWriteAccepted(state: TallerStatusState, itemId: string) {
  const expected = state.pending[itemId];
  if (!expected || state.overrides[itemId] !== expected) return state;
  return {
    ...state,
    pending: withoutKey(state.pending, itemId),
    awaitingConfirmation: { ...state.awaitingConfirmation, [itemId]: expected },
  };
}

export function rollbackTallerStatusUpdate(
  state: TallerStatusState,
  itemId: string,
  message: string,
) {
  return {
    ...state,
    overrides: withoutKey(state.overrides, itemId),
    pending: withoutKey(state.pending, itemId),
    awaitingConfirmation: withoutKey(state.awaitingConfirmation, itemId),
    errors: { ...state.errors, [itemId]: message },
  };
}

export function reconcileTallerStatusSnapshot(
  state: TallerStatusState,
  serverStatuses: Readonly<Record<string, string>>,
  serverConfirmed: boolean,
) {
  let next = state;
  Object.entries(state.overrides).forEach(([itemId, optimisticStatus]) => {
    const serverStatus = serverStatuses[itemId];
    const itemExists = serverStatus !== undefined;
    const confirmedExpected = serverConfirmed
      && itemExists
      && normalizedStatus(serverStatus) === normalizedStatus(optimisticStatus);
    const staleAfterServerConfirmation = serverConfirmed
      && Boolean(state.awaitingConfirmation[itemId])
      && !confirmedExpected;
    const staleWithoutRequest = !state.pending[itemId] && !state.awaitingConfirmation[itemId];

    if (confirmedExpected || !itemExists || staleAfterServerConfirmation || staleWithoutRequest) {
      next = {
        ...next,
        overrides: withoutKey(next.overrides, itemId),
        pending: withoutKey(next.pending, itemId),
        awaitingConfirmation: withoutKey(next.awaitingConfirmation, itemId),
        errors: staleAfterServerConfirmation
          ? { ...next.errors, [itemId]: 'El servidor confirmó un estado diferente. Se restauró el valor real.' }
          : withoutKey(next.errors, itemId),
      };
    }
  });
  return next;
}

export function effectiveTallerStatus(
  state: TallerStatusState,
  itemId: string,
  serverStatus: string,
) {
  return state.overrides[itemId] ?? serverStatus;
}

function statusPriority(status: string, order: TallerStatusOrder) {
  const normalized = normalizedStatus(status);
  const category = normalized.includes('mant')
    ? 'maintenance'
    : normalized.includes('disponible') || normalized.includes('bueno') || normalized.includes('ok')
      ? 'good'
      : 'other';
  if (order === 'good-first') return category === 'good' ? 0 : category === 'other' ? 1 : 2;
  if (order === 'maintenance-first') return category === 'maintenance' ? 0 : category === 'other' ? 1 : 2;
  return 0;
}

export function tallerStatusRank(status: string, order: TallerStatusOrder) {
  return statusPriority(status, order);
}

export function sortTallerInventory<T extends SortableTallerItem>(
  items: readonly T[],
  order: TallerStatusOrder,
  statusFor: (item: T) => string,
) {
  return [...items].sort((left, right) => (
    statusPriority(statusFor(left), order) - statusPriority(statusFor(right), order)
    || left.codigo.localeCompare(right.codigo, undefined, { numeric: true, sensitivity: 'base' })
    || left.descripcion.localeCompare(right.descripcion)
    || left.id.localeCompare(right.id)
  ));
}
