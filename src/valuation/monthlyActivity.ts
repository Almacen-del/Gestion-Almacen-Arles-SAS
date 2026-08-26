import { classifyInventoryMovementType } from '../inventoryAnalysis/engine';
import { adaptInventoryAnalysisSources, type InventoryAnalysisSourceMovement } from '../inventoryAnalysis/sourceAdapter';
import { movementDateKey, normalizeMovementText } from '../movementView';
import { isInventoryValuationModuleIncluded } from './inventoryValuationScope';
import { currentBogotaPeriod } from './monthlyCloseSafety';
import type { CurrentValuationRow } from './models';

export type MonthlyActivitySource = InventoryAnalysisSourceMovement & {
  unit?: string;
  destinationLot?: string;
  observations?: string;
  zone?: string;
  labor?: string;
  front?: string;
  recipientId?: string;
  recipientName?: string;
};

export type MonthlyActivityRow = {
  id: string;
  kind: 'entry' | 'exit';
  occurredAt: string;
  moduleName: string;
  productId: string;
  code: string;
  product: string;
  reference: string;
  quantity: number;
  unit: string;
  destinationLot: string;
  recipientId: string;
  recipientName: string;
  unitValue: number | null;
  priceUnit: string;
  expense: number | null;
  issue: '' | 'Producto no identificado' | 'Sin precio' | 'Unidad incompatible';
};

export type MonthlyActivitySnapshot = {
  period: string;
  cutoffAt: string;
  invalidDateCount: number;
  invalidQuantityCount: number;
  rows: MonthlyActivityRow[];
};

export const UNKNOWN_DESTINATION_LOT = 'Sin lote de destino';
export const FUEL_ROUTE_DESTINATION = 'recorrido salida/PLANTACION';

function isRouteLabel(value: string | undefined) {
  return /^recorridos?[.,;]?$/.test(normalizeMovementText(value ?? ''));
}

export function destinationLotOf(source: MonthlyActivitySource) {
  const explicit = source.destinationLot?.trim();
  const destinationTexts = [source.observations, source.zone, source.labor, source.front];
  const fuelRoute = normalizeMovementText(source.module) === 'combustible'
    && (isRouteLabel(explicit) || destinationTexts.some(isRouteLabel));
  // El lote de fabricación y los lotes FEFO no son destinos del consumo.
  const labelled = destinationTexts.flatMap((text) => {
    const match = /\blotes?(?:\s+de\s+destino)?(?:\s*[:=#]\s*|\s+(?=[\d]))([^;|\n·]+)/i.exec(text ?? '');
    return match ? [match[1]
      .split(/\s+\b(?:responsable|fecha|cargo|registro|hora)\b\s*:?/i)[0]
      .split(/\s+\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i)[0]
      .trim()] : [];
  })[0];
  const value = (explicit || labelled || (fuelRoute ? FUEL_ROUTE_DESTINATION : '')).replace(/^lotes?\s*[:=#]?\s*/i, '').replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
  if (fuelRoute && isRouteLabel(value)) return FUEL_ROUTE_DESTINATION;
  return !value || /^(?:n\/?a|sin (?:lote|asignar)|no registrado)$/i.test(value)
    ? UNKNOWN_DESTINATION_LOT : value;
}

// Display-only recovery for earlier cuts: never replace a known destination or
// recalculate their amounts. Require the same original movement, not a product match.
export function recoverMonthlyDestinations(snapshot: MonthlyActivitySnapshot, sources: readonly MonthlyActivitySource[]) {
  const byId = new Map<string, MonthlyActivitySource | null>();
  sources.forEach((source) => byId.set(source.id, byId.has(source.id) ? null : source));
  let recoveredCount = 0;
  const rows = snapshot.rows.map((row) => {
    if (row.kind !== 'exit' || (row.destinationLot && row.destinationLot !== UNKNOWN_DESTINATION_LOT)) return row;
    const source = byId.get(row.id);
    if (!source || normalizeMovementText(source.module) !== normalizeMovementText(row.moduleName)
      || classifyInventoryMovementType(source.type) !== row.kind || source.quantity !== row.quantity
      || movementTime(source.occurredAt) !== movementTime(row.occurredAt)) return row;
    const destinationLot = destinationLotOf(source);
    if (destinationLot === UNKNOWN_DESTINATION_LOT) return row;
    recoveredCount += 1;
    return { ...row, destinationLot };
  });
  return { snapshot: recoveredCount ? { ...snapshot, rows } : snapshot, recoveredCount };
}

function movementTime(value: string) {
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return Date.parse(value);
  const key = movementDateKey(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
  const time = /[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(value)?.[1] ?? '00:00:00';
  const parsed = Date.parse(`${key}T${time}-05:00`);
  return Number.isFinite(parsed) && new Date(parsed - 5 * 60 * 60 * 1000).toISOString().startsWith(key) ? parsed : NaN;
}

export function formatMonthlyActivityDate(value: string) {
  const time = movementTime(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(time)) : value;
}

function unitKey(unit: string) {
  const key = normalizeMovementText(unit).replace(/[.\s]/g, '');
  if (['g', 'gr', 'gramo', 'gramos'].includes(key)) return 'g';
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(key)) return 'kg';
  if (['ml', 'mililitro', 'mililitros'].includes(key)) return 'ml';
  if (['l', 'lt', 'litro', 'litros'].includes(key)) return 'l';
  if (['u', 'und', 'unidad', 'unidades'].includes(key)) return 'unidad';
  return key;
}

function quantityAtPriceUnit(quantity: number, from: string, to: string) {
  const source = unitKey(from);
  const target = unitKey(to);
  if (source && source === target) return quantity;
  if ((source === 'kg' && target === 'g') || (source === 'l' && target === 'ml')) return quantity * 1000;
  if ((source === 'g' && target === 'kg') || (source === 'ml' && target === 'l')) return quantity / 1000;
  return null;
}

export function buildMonthlyActivity(
  period: string,
  valuations: readonly CurrentValuationRow[],
  sources: readonly MonthlyActivitySource[],
  cutoffAt: Date,
): MonthlyActivitySnapshot {
  const cutoff = cutoffAt.getTime();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Number.isFinite(cutoff)) throw new Error('Mes o fecha de corte inválidos.');
  const scopedValuations = valuations.filter((row) => isInventoryValuationModuleIncluded(row.moduleName));
  const products = scopedValuations.map((row) => {
    const [collection, ...idParts] = row.valuationId.split('__');
    const documentId = decodeURIComponent(idParts.join('__'));
    return {
      id: `${collection === 'productos_aseo' ? 'aseo-' : collection === 'herramientas' ? 'herramienta-' : ''}${documentId}`,
      module: row.moduleName, code: row.code, name: row.product,
      reference: row.reference, category: '', unit: row.unit,
    };
  });
  let invalidDateCount = 0;
  let invalidQuantityCount = 0;
  const scopedSources = [...new Map(sources.map((source) => [source.id, source])).values()].filter((source) => {
    if (!isInventoryValuationModuleIncluded(source.module)) return false;
    const kind = classifyInventoryMovementType(source.type);
    if (kind !== 'entry' && kind !== 'exit') return false;
    const time = movementTime(source.occurredAt);
    if (!Number.isFinite(time)) { invalidDateCount += 1; return false; }
    if (time > cutoff || currentBogotaPeriod(new Date(time)) !== period) return false;
    if (!Number.isFinite(source.quantity) || source.quantity <= 0) { invalidQuantityCount += 1; return false; }
    return true;
  });
  const adapted = adaptInventoryAnalysisSources(products, scopedSources);
  const productIdByMovement = new Map(adapted.movements.map((movement) => [movement.id, movement.productId]));
  const valuationById = new Map(scopedValuations.map((row) => [row.valuationId, row]));
  const rows = scopedSources.map((source): MonthlyActivityRow => {
    const productId = productIdByMovement.get(source.id) ?? '';
    const valuation = valuationById.get(productId);
    const kind = classifyInventoryMovementType(source.type) === 'entry' ? 'entry' : 'exit';
    const unit = source.unit?.trim() || valuation?.unit || 'Sin unidad';
    const price = valuation && Number.isFinite(valuation.unitValue) && valuation.unitValue > 0 ? valuation.unitValue : null;
    const pricedQuantity = valuation ? quantityAtPriceUnit(source.quantity, unit, valuation.unit) : null;
    const issue = !valuation ? 'Producto no identificado' : price === null ? 'Sin precio' : pricedQuantity === null ? 'Unidad incompatible' : '';
    return {
      id: source.id, kind, occurredAt: source.occurredAt,
      moduleName: valuation?.moduleName ?? source.module,
      productId, code: valuation?.code ?? source.code, product: valuation?.product ?? source.name,
      reference: valuation?.reference ?? source.reference,
      quantity: source.quantity, unit, destinationLot: destinationLotOf(source),
      recipientId: source.recipientId?.trim() ?? '',
      recipientName: source.recipientName?.trim() || source.recipientId?.trim() || 'Sin personal identificado',
      unitValue: price, priceUnit: valuation?.unit ?? '',
      expense: kind === 'exit' && !issue ? pricedQuantity! * price! : null,
      issue,
    };
  }).sort((a, b) => movementTime(b.occurredAt) - movementTime(a.occurredAt) || a.id.localeCompare(b.id));
  return { period, cutoffAt: cutoffAt.toISOString(), invalidDateCount, invalidQuantityCount, rows };
}

export function summarizeMonthlyActivity(rows: readonly MonthlyActivityRow[]) {
  const entries = rows.filter((row) => row.kind === 'entry');
  const exits = rows.filter((row) => row.kind === 'exit');
  return {
    movementCount: rows.length, entryCount: entries.length, exitCount: exits.length,
    estimatedExpense: exits.reduce((sum, row) => sum + (row.expense ?? 0), 0),
    unpricedExitCount: exits.filter((row) => row.expense === null).length,
    withoutLotCount: exits.filter((row) => row.destinationLot === UNKNOWN_DESTINATION_LOT).length,
  };
}

export type ExpenseGrouping = 'lot' | 'module' | 'product' | 'person';
export function isPersonnelExpense(row: MonthlyActivityRow) {
  return ['dotacion', 'epp'].includes(normalizeMovementText(row.moduleName));
}
export function groupMonthlyExpenses(rows: readonly MonthlyActivityRow[], by: ExpenseGrouping) {
  const groups = new Map<string, { id: string; label: string; expense: number; unpriced: number; rows: MonthlyActivityRow[] }>();
  rows.filter((row) => row.kind === 'exit' && (by !== 'person' || isPersonnelExpense(row))).forEach((row) => {
    const label = by === 'person' ? row.recipientName : by === 'lot' ? row.destinationLot : by === 'module' ? row.moduleName : `${row.code || 'Sin código'} · ${row.product}`;
    const id = by === 'person' ? (row.recipientId.startsWith('uid:') ? row.recipientId : normalizeMovementText(row.recipientId || label).replace(/\s+/g, ' '))
      : by === 'product' ? row.productId || JSON.stringify([row.moduleName, row.code, row.product]) : normalizeMovementText(label);
    const group = groups.get(id) ?? { id, label, expense: 0, unpriced: 0, rows: [] };
    group.expense += row.expense ?? 0;
    group.unpriced += row.expense === null ? 1 : 0;
    group.rows.push(row);
    groups.set(id, group);
  });
  return [...groups.values()].sort((a, b) => b.expense - a.expense || a.label.localeCompare(b.label));
}
