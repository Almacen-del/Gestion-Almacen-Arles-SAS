export type MovementViewRecord = {
  id: string;
  modulo: string;
  tipo: string;
  codigo: string;
  descripcion: string;
  referencia: string;
  cantidad: number;
  unidad: string;
  fecha: string;
  solicitante: string;
  cargo: string;
  usuario: string;
  observaciones: string;
  fotoUrl: string;
  ubicacion?: string;
  submodulo?: string;
  maquinaria?: string;
  zona?: string;
  labor?: string;
  frente?: string;
  horometro?: string;
  responsableEntrega?: string;
};

export type MovementViewFilters<T extends MovementViewRecord> = {
  search: string;
  dateFrom: string;
  dateTo: string;
  code: string;
  person: string;
  product: string;
  belongsToScope: (movement: T) => boolean;
  personText: (movement: T) => string;
  statusRank?: (movement: T) => number;
};

export type MovementHistoryAutoLoadState = {
  activeScopeHasMovements: boolean;
  alreadyAttempted: boolean;
  hasMoreMovements: boolean;
  isLoading: boolean;
  isOnline: boolean;
  isServerReady: boolean;
  isValuationModule: boolean;
};

export const MOVEMENT_PAGE_SIZE = 250;

export function movementDisplayCount(
  totalCount: number,
  requestedCount: number,
  hasActiveFilters: boolean,
) {
  if (totalCount <= 0) return 0;
  if (hasActiveFilters) return totalCount;
  return Math.min(totalCount, Math.max(requestedCount, 0));
}

export function nextMovementDisplayLimit(currentCount: number, pageSize: number) {
  return Math.max(currentCount, 0) + Math.max(pageSize, 1);
}

export function loadedMovementHistoryCoversDate(
  movements: readonly Pick<MovementViewRecord, 'fecha'>[],
  dateFrom: string,
) {
  if (!dateFrom) return false;
  const oldestLoadedDate = movements
    .map((movement) => movementDateKey(movement.fecha))
    .filter(Boolean)
    .sort()[0];
  return Boolean(oldestLoadedDate && oldestLoadedDate <= dateFrom);
}

export function shouldAutoLoadCompleteMovementHistory({
  activeScopeHasMovements,
  alreadyAttempted,
  hasMoreMovements,
  isLoading,
  isOnline,
  isServerReady,
  isValuationModule,
}: MovementHistoryAutoLoadState) {
  return !isValuationModule
    && isOnline
    && isServerReady
    && hasMoreMovements
    && !isLoading
    && !activeScopeHasMovements
    && !alreadyAttempted;
}

export function normalizeMovementText(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function formatDateKey(date: Date) {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function movementDateKey(value: string) {
  const text = value.trim();
  if (!text) return '';

  const iso = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

  const dmy = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  return formatDateKey(new Date(text));
}

export function movementInDateRange(value: string, from: string, to: string) {
  if (!from && !to) return true;
  const key = movementDateKey(value);
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function searchableMovementText<T extends MovementViewRecord>(movement: T, personText: string) {
  return normalizeMovementText([
    movement.modulo,
    movement.tipo,
    movement.codigo,
    movement.descripcion,
    movement.referencia,
    movement.unidad,
    movement.ubicacion,
    movement.submodulo,
    movement.maquinaria,
    movement.zona,
    movement.labor,
    movement.frente,
    movement.horometro,
    personText,
  ].filter(Boolean).join(' '));
}

export function filterAndSortMovementView<T extends MovementViewRecord>(
  movements: readonly T[],
  filters: MovementViewFilters<T>,
) {
  const search = normalizeMovementText(filters.search);
  const code = normalizeMovementText(filters.code);
  const person = normalizeMovementText(filters.person);
  const product = normalizeMovementText(filters.product);

  return movements
    .filter(filters.belongsToScope)
    .filter((movement) => movementInDateRange(movement.fecha, filters.dateFrom, filters.dateTo))
    .filter((movement) => !code || normalizeMovementText(movement.codigo).includes(code))
    .filter((movement) => {
      const personValue = normalizeMovementText(filters.personText(movement));
      return !person || personValue.includes(person);
    })
    .filter((movement) => {
      const itemValue = normalizeMovementText([
        movement.codigo,
        movement.descripcion,
        movement.referencia,
        movement.unidad,
      ].filter(Boolean).join(' '));
      return !product || itemValue.includes(product);
    })
    .filter((movement) => !search || searchableMovementText(
      movement,
      filters.personText(movement),
    ).includes(search))
    .sort((left, right) => {
      if (filters.statusRank) {
        const rankDifference = filters.statusRank(left) - filters.statusRank(right);
        if (rankDifference !== 0) return rankDifference;
      }
      return (right.fecha || '').localeCompare(left.fecha || '')
        || left.id.localeCompare(right.id);
    });
}

export function mergeMovementPages<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
) {
  const byId = new Map(current.map((movement) => [movement.id, movement]));
  incoming.forEach((movement) => byId.set(movement.id, movement));
  return [...byId.values()];
}

export function movementPageHasMore(receivedCount: number, pageSize = MOVEMENT_PAGE_SIZE) {
  return receivedCount === pageSize;
}
