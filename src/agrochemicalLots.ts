const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type AgrochemicalLot = {
  id: string;
  productDocumentId: string;
  productCode: string;
  productName: string;
  lotNumber: string;
  expirationDate: string;
  quantity: number;
  initialQuantity: number;
  unit: string;
  location: string;
  receivedAt: string;
  entryAssignments: AgrochemicalLotEntryAssignment[];
};

export type AgrochemicalLotEntryAssignment = {
  entryId: string;
  quantity: number;
};

export type AgrochemicalStockEntry = {
  id: string;
  productDocumentId: string;
  moduleName: string;
  code: string;
  productName: string;
  quantity: number;
  unit: string;
  dateLabel: string;
  dateKey: string;
  createdAtMs: number | null;
  validationIssue: string;
};

export type AgrochemicalPendingEntry = AgrochemicalStockEntry & {
  assignedQuantity: number;
  pendingQuantity: number;
  assignmentStatus: 'pending' | 'partial' | 'assigned' | 'invalid';
};

export type AgrochemicalLotStatus = 'expired' | 'near-expiry' | 'valid' | 'empty' | 'missing-date';

export type FefoAllocation = {
  lotId: string;
  lotNumber: string;
  expirationDate: string;
  quantity: number;
};

function dateKeyToUtc(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Number.NaN;
  const result = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(result);
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) return Number.NaN;
  return result;
}

export function daysUntilExpiration(expirationDate: string, cutoffDate: string) {
  const expirationUtc = dateKeyToUtc(expirationDate);
  const cutoffUtc = dateKeyToUtc(cutoffDate);
  if (!Number.isFinite(expirationUtc) || !Number.isFinite(cutoffUtc)) return null;
  return Math.floor((expirationUtc - cutoffUtc) / DAY_IN_MS);
}

export function classifyAgrochemicalLot(
  lot: Pick<AgrochemicalLot, 'expirationDate' | 'quantity'>,
  cutoffDate: string,
  nearExpiryDays = 30,
): AgrochemicalLotStatus {
  if (lot.quantity <= 0) return 'empty';
  const days = daysUntilExpiration(lot.expirationDate, cutoffDate);
  if (days === null) return 'missing-date';
  if (days < 0) return 'expired';
  if (days <= Math.max(0, nearExpiryDays)) return 'near-expiry';
  return 'valid';
}

export function sortAgrochemicalLotsByFefo(lots: readonly AgrochemicalLot[]) {
  return [...lots].sort((left, right) => (
    (dateKeyToUtc(left.expirationDate) || Number.POSITIVE_INFINITY)
    - (dateKeyToUtc(right.expirationDate) || Number.POSITIVE_INFINITY)
    || left.receivedAt.localeCompare(right.receivedAt)
    || left.lotNumber.localeCompare(right.lotNumber)
  ));
}

export function allocateAgrochemicalExitFefo(
  lots: readonly AgrochemicalLot[],
  requestedQuantity: number,
  cutoffDate: string,
) {
  let remaining = Math.max(0, requestedQuantity);
  const allocations: FefoAllocation[] = [];
  const eligibleLots = sortAgrochemicalLotsByFefo(lots).filter((lot) => (
    lot.quantity > 0
    && classifyAgrochemicalLot(lot, cutoffDate) !== 'expired'
    && classifyAgrochemicalLot(lot, cutoffDate) !== 'missing-date'
  ));
  eligibleLots.forEach((lot) => {
    if (remaining <= 0) return;
    const quantity = Math.min(lot.quantity, remaining);
    if (quantity <= 0) return;
    allocations.push({
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      expirationDate: lot.expirationDate,
      quantity,
    });
    remaining -= quantity;
  });
  return { allocations, shortage: remaining };
}

export function agrochemicalLotDocumentId(lotNumber: string, expirationDate: string) {
  const normalizedLot = lotNumber
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalizedLot || !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) return '';
  return `${normalizedLot}__${expirationDate}`;
}

function normalizeModule(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function buildAgrochemicalEntryQueue(
  entries: readonly AgrochemicalStockEntry[],
  lots: readonly AgrochemicalLot[],
) {
  const assignedByEntry = new Map<string, number>();
  lots.forEach((lot) => lot.entryAssignments.forEach((assignment) => {
    assignedByEntry.set(
      assignment.entryId,
      (assignedByEntry.get(assignment.entryId) ?? 0) + Math.max(0, assignment.quantity),
    );
  }));
  return entries
    .filter((entry) => normalizeModule(entry.moduleName).includes('AGROQUIMICO'))
    .map((entry): AgrochemicalPendingEntry => {
      const assignedQuantity = assignedByEntry.get(entry.id) ?? 0;
      const pendingQuantity = Math.max(0, entry.quantity - assignedQuantity);
      const invalid = Boolean(entry.validationIssue)
        || !entry.productDocumentId
        || !Number.isFinite(entry.quantity)
        || entry.quantity <= 0
        || assignedQuantity > entry.quantity + 1e-7;
      return {
        ...entry,
        assignedQuantity,
        pendingQuantity,
        assignmentStatus: invalid
          ? 'invalid'
          : pendingQuantity <= 1e-7
            ? 'assigned'
            : assignedQuantity > 0
              ? 'partial'
              : 'pending',
      };
    })
    .sort((left, right) => (
      (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0)
      || right.id.localeCompare(left.id)
    ));
}
