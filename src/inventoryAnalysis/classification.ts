import { movementDateKey } from '../movementView';
import type {
  InventoryAnalysisThresholds,
  InventoryClassification,
  InventoryClassificationStatus,
  InventoryPeriodAnalysis,
} from './models';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS: InventoryAnalysisThresholds = {
  lowTurnoverMaximum: 0.25,
  lowTurnoverAfterDays: 30,
  noMovementAfterDays: 90,
  possibleObsolescenceAfterDays: 180,
  nearExpiryDays: 30,
};

const STATUS_LABELS: Record<InventoryClassificationStatus, string> = {
  normal: 'Movimiento normal',
  'low-turnover': 'Baja rotación',
  'no-movement': 'Sin movimiento',
  review: 'Revisar',
  'possible-obsolescence': 'Posible obsolescencia',
  'confirmed-obsolete': 'Obsoleto confirmado',
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

function nonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeInventoryAnalysisThresholds(
  input: Partial<InventoryAnalysisThresholds> | null | undefined,
): InventoryAnalysisThresholds {
  return {
    lowTurnoverMaximum: nonNegativeNumber(
      input?.lowTurnoverMaximum,
      DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS.lowTurnoverMaximum,
    ),
    lowTurnoverAfterDays: Math.round(nonNegativeNumber(
      input?.lowTurnoverAfterDays,
      DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS.lowTurnoverAfterDays,
    )),
    noMovementAfterDays: Math.round(nonNegativeNumber(
      input?.noMovementAfterDays,
      DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS.noMovementAfterDays,
    )),
    possibleObsolescenceAfterDays: Math.round(nonNegativeNumber(
      input?.possibleObsolescenceAfterDays,
      DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS.possibleObsolescenceAfterDays,
    )),
    nearExpiryDays: Math.round(nonNegativeNumber(
      input?.nearExpiryDays,
      DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS.nearExpiryDays,
    )),
  };
}

export function classifyInventoryAnalysis(
  analysis: InventoryPeriodAnalysis,
  rawThresholds: Partial<InventoryAnalysisThresholds> = DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS,
): InventoryClassification {
  const thresholds = normalizeInventoryAnalysisThresholds(rawThresholds);
  const expirationKey = analysis.product.expirationDate
    ? movementDateKey(analysis.product.expirationDate)
    : '';
  const cutoffUtc = dateKeyToUtc(analysis.period.to);
  const expirationUtc = dateKeyToUtc(expirationKey);
  const expirationDays = Number.isFinite(cutoffUtc) && Number.isFinite(expirationUtc)
    ? Math.floor((expirationUtc - cutoffUtc) / DAY_IN_MS)
    : null;
  const hasStockAtClose = analysis.closingInventory !== null && analysis.closingInventory > 0;
  const expired = hasStockAtClose && expirationDays !== null && expirationDays < 0;
  const nearExpiry = hasStockAtClose
    && expirationDays !== null
    && expirationDays >= 0
    && expirationDays <= thresholds.nearExpiryDays;

  if (analysis.product.confirmedObsolete) {
    return {
      status: 'confirmed-obsolete',
      label: STATUS_LABELS['confirmed-obsolete'],
      reasons: ['El producto tiene una confirmación manual de obsolescencia.'],
      expired,
      nearExpiry,
    };
  }

  if (analysis.quality !== 'exact') {
    return {
      status: 'review',
      label: STATUS_LABELS.review,
      reasons: ['El histórico no es suficiente o contiene inconsistencias; los indicadores requieren revisión.'],
      expired,
      nearExpiry,
    };
  }

  if (!hasStockAtClose) {
    return {
      status: 'review',
      label: STATUS_LABELS.review,
      reasons: ['El producto no tiene existencias al cierre; no se clasifica como movimiento normal ni como obsolescencia.'],
      expired,
      nearExpiry,
    };
  }

  if (expired) {
    return {
      status: 'possible-obsolescence',
      label: STATUS_LABELS['possible-obsolescence'],
      reasons: ['El producto conserva existencias y su fecha de vencimiento es anterior al corte.'],
      expired,
      nearExpiry,
    };
  }

  if (
    analysis.daysWithoutMovement !== null
    && analysis.daysWithoutMovement >= thresholds.possibleObsolescenceAfterDays
  ) {
    return {
      status: 'possible-obsolescence',
      label: STATUS_LABELS['possible-obsolescence'],
      reasons: [`Acumula ${analysis.daysWithoutMovement} días sin salidas y supera el límite configurado de posible obsolescencia.`],
      expired,
      nearExpiry,
    };
  }

  if (analysis.lastExitDate === null) {
    return {
      status: 'no-movement',
      label: STATUS_LABELS['no-movement'],
      reasons: ['No existen salidas registradas hasta la fecha de corte.'],
      expired,
      nearExpiry,
    };
  }

  if (
    analysis.daysWithoutMovement !== null
    && analysis.daysWithoutMovement >= thresholds.noMovementAfterDays
  ) {
    return {
      status: 'no-movement',
      label: STATUS_LABELS['no-movement'],
      reasons: [`Acumula ${analysis.daysWithoutMovement} días sin salidas.`],
      expired,
      nearExpiry,
    };
  }

  if (
    analysis.turnover !== null
    && analysis.turnover <= thresholds.lowTurnoverMaximum
    && analysis.daysWithoutMovement !== null
    && analysis.daysWithoutMovement >= thresholds.lowTurnoverAfterDays
  ) {
    return {
      status: 'low-turnover',
      label: STATUS_LABELS['low-turnover'],
      reasons: [`La rotación es ${analysis.turnover.toFixed(2)} y han pasado ${analysis.daysWithoutMovement} días desde la última salida.`],
      expired,
      nearExpiry,
    };
  }

  const reasons = ['El producto no supera los límites configurados de alerta.'];
  if (nearExpiry) reasons.push(`El vencimiento está dentro de los próximos ${thresholds.nearExpiryDays} días.`);
  return { status: 'normal', label: STATUS_LABELS.normal, reasons, expired, nearExpiry };
}
