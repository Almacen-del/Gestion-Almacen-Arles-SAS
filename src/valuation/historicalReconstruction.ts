import { summarizeCurrentValuation } from './currentValuation';
import { buildMonthlyActivity, quantityAtPriceUnit, summarizeMonthlyActivity, type MonthlyActivitySnapshot, type MonthlyActivitySource } from './monthlyActivity';
import { currentBogotaPeriod } from './monthlyCloseSafety';
import type { CurrentValuationRow, CurrentValuationSummary } from './models';

export type HistoricalReconstruction = {
  period: string;
  cutoffAt: Date;
  rows: CurrentValuationRow[];
  activity: MonthlyActivitySnapshot;
  summary: CurrentValuationSummary;
  reversedMovementCount: number;
  blockingIssues: string[];
  blockingDetails: string[];
  notes: string[];
};

function periodParts(period: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error('Período mensual inválido.');
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function monthEndBogota(period: string) {
  const { year, month } = periodParts(period);
  return new Date(Date.UTC(year, month, 1, 4, 59, 59, 999));
}

export function shiftPeriod(period: string, offset: number) {
  const { year, month } = periodParts(period);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function priorPeriods(period: string, count: number) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => shiftPeriod(period, -(index + 1)));
}

function periodsAfter(period: string, through: string) {
  const result: string[] = [];
  for (let cursor = shiftPeriod(period, 1); cursor <= through; cursor = shiftPeriod(cursor, 1)) result.push(cursor);
  return result;
}

function cleanQuantity(value: number) {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(9));
}

export function reconstructHistoricalMonthlyClose({
  period,
  currentRows,
  moduleOptions,
  movements,
  now = new Date(),
}: {
  period: string;
  currentRows: readonly CurrentValuationRow[];
  moduleOptions: readonly string[];
  movements: readonly MonthlyActivitySource[];
  now?: Date;
}): HistoricalReconstruction {
  const currentPeriod = currentBogotaPeriod(now);
  if (period >= currentPeriod) throw new Error('La reconstrucción solo admite meses anteriores al actual.');

  const currentById = new Map(currentRows.map((row) => [row.valuationId, row]));
  const quantityById = new Map(currentRows.map((row) => [row.valuationId, row.quantity]));
  const laterSnapshots = periodsAfter(period, currentPeriod).map((candidate) => buildMonthlyActivity(
    candidate,
    [...currentRows],
    movements,
    candidate === currentPeriod ? now : monthEndBogota(candidate),
  ));
  const laterRows = laterSnapshots.flatMap((snapshot) => snapshot.rows);
  let unidentifiedCount = 0;
  let incompatibleCount = 0;
  const blockingDetails: string[] = [];

  laterRows.forEach((movement) => {
    const product = currentById.get(movement.productId);
    if (!product) {
      unidentifiedCount += 1;
      blockingDetails.push(`${movement.occurredAt} · ${movement.code || 'Sin código'} · ${movement.product}: producto no identificable.`);
      return;
    }
    const converted = quantityAtPriceUnit(movement.quantity, movement.unit, product.unit);
    if (converted === null) {
      incompatibleCount += 1;
      blockingDetails.push(`${movement.occurredAt} · ${movement.code || 'Sin código'} · ${movement.product}: ${movement.quantity} ${movement.unit} no se puede convertir a ${product.unit}.`);
      return;
    }
    const currentQuantity = quantityById.get(product.valuationId) ?? 0;
    quantityById.set(product.valuationId, cleanQuantity(currentQuantity + (movement.kind === 'exit' ? converted : -converted)));
  });

  const rows = currentRows.map((row) => {
    const quantity = quantityById.get(row.valuationId) ?? row.quantity;
    return { ...row, quantity, totalValue: quantity * row.unitValue };
  });
  const negativeRows = rows.filter((row) => row.quantity < -1e-9);
  negativeRows.forEach((row) => blockingDetails.push(`${row.code || 'Sin código'} · ${row.product}: existencia reconstruida ${row.quantity} ${row.unit}.`));
  const invalidLaterDates = laterSnapshots.reduce((sum, snapshot) => sum + snapshot.invalidDateCount, 0);
  const invalidLaterQuantities = laterSnapshots.reduce((sum, snapshot) => sum + snapshot.invalidQuantityCount, 0);
  const blockingIssues: string[] = [];
  if (unidentifiedCount) blockingIssues.push(`${unidentifiedCount} movimiento(s) posterior(es) no tienen producto identificable.`);
  if (incompatibleCount) blockingIssues.push(`${incompatibleCount} movimiento(s) posterior(es) tienen una unidad incompatible con el inventario.`);
  if (invalidLaterDates) blockingIssues.push(`${invalidLaterDates} movimiento(s) posterior(es) no tienen una fecha válida.`);
  if (invalidLaterQuantities) blockingIssues.push(`${invalidLaterQuantities} movimiento(s) posterior(es) tienen una cantidad inválida.`);
  if (negativeRows.length) blockingIssues.push(`${negativeRows.length} producto(s) quedarían con existencia negativa al reconstruir el mes.`);

  const cutoffAt = monthEndBogota(period);
  const activity = buildMonthlyActivity(period, rows, movements, cutoffAt);
  const activitySummary = summarizeMonthlyActivity(activity.rows);
  const summary = summarizeCurrentValuation(rows, [...moduleOptions]);
  return {
    period,
    cutoffAt,
    rows,
    activity,
    summary,
    reversedMovementCount: laterRows.length,
    blockingIssues,
    blockingDetails,
    notes: [
      `Existencias reconstruidas al cierre de ${period} revirtiendo ${laterRows.length} movimiento(s) posterior(es).`,
      `Valoración estimada con los precios actuales del inventario al ${now.toISOString()}.`,
      `${activitySummary.entryCount} entrada(s) y ${activitySummary.exitCount} salida(s) pertenecen al mes reconstruido.`,
    ],
  };
}
