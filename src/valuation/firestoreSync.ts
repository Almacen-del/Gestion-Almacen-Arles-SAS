export const FIRESTORE_SOURCE_KEYS = [
  'inventory',
  'aseo',
  'tools',
  'valuations',
  'entryMovements',
  'entryValuations',
  'movements',
  'users',
] as const;

export type FirestoreSourceKey = typeof FIRESTORE_SOURCE_KEYS[number];

export const PANEL_REQUIRED_SOURCE_KEYS = [
  'inventory',
  'aseo',
  'tools',
  'valuations',
  'entryMovements',
  'entryValuations',
] as const;

export const CLOSE_REQUIRED_SOURCE_KEYS = [
  'inventory',
  'aseo',
  'valuations',
  'entryMovements',
  'entryValuations',
] as const;

export type PanelRequiredSourceKey = typeof PANEL_REQUIRED_SOURCE_KEYS[number];
export type CloseRequiredSourceKey = typeof CLOSE_REQUIRED_SOURCE_KEYS[number];

export const FIRESTORE_SOURCE_LABELS: Record<FirestoreSourceKey, string> = {
  inventory: 'existencias',
  aseo: 'productos_aseo',
  tools: 'herramientas',
  valuations: 'valoraciones_inventario',
  entryMovements: 'entradas_stock',
  entryValuations: 'valoraciones_entradas',
  movements: 'movimientos',
  users: 'usuarios',
};

export type FirestoreSourceState = {
  received: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
  error: string;
};

export type FirestoreSourceStates = Record<FirestoreSourceKey, FirestoreSourceState>;

export const EMPTY_FIRESTORE_SOURCE_STATE: FirestoreSourceState = {
  received: false,
  fromCache: false,
  hasPendingWrites: false,
  error: '',
};

export function createInitialFirestoreSourceStates(): FirestoreSourceStates {
  return Object.fromEntries(FIRESTORE_SOURCE_KEYS.map((key) => [
    key,
    { ...EMPTY_FIRESTORE_SOURCE_STATE },
  ])) as FirestoreSourceStates;
}

export function stateFromSnapshot(metadata: {
  fromCache: boolean;
  hasPendingWrites: boolean;
}): FirestoreSourceState {
  return {
    received: true,
    fromCache: metadata.fromCache,
    hasPendingWrites: metadata.hasPendingWrites,
    error: '',
  };
}

export function updateSourceFromSnapshot(
  states: FirestoreSourceStates,
  source: FirestoreSourceKey,
  metadata: { fromCache: boolean; hasPendingWrites: boolean },
): FirestoreSourceStates {
  return { ...states, [source]: stateFromSnapshot(metadata) };
}

export function updateSourceWithError(
  states: FirestoreSourceStates,
  source: FirestoreSourceKey,
  error: string,
): FirestoreSourceStates {
  return { ...states, [source]: { ...states[source], error } };
}

export function isServerSourceReady(state: FirestoreSourceState) {
  return state.received
    && !state.fromCache
    && !state.hasPendingWrites
    && !state.error;
}

export function areSourcesServerReady(
  states: FirestoreSourceStates,
  keys: readonly FirestoreSourceKey[],
) {
  return keys.every((key) => isServerSourceReady(states[key]));
}

export function sourceErrorMessages(states: FirestoreSourceStates) {
  return FIRESTORE_SOURCE_KEYS.flatMap((key) => (
    states[key].error ? [`${FIRESTORE_SOURCE_LABELS[key]}: ${states[key].error}`] : []
  ));
}
