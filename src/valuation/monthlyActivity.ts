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
  position?: string;
  machinery?: string;
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
  machinery?: string; // Optional for cuts saved before machinery was included.
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
export const FUEL_ROUTE_DESTINATION = 'Plantación';
export const PERSONAL_DESTINATION = 'Personal';

function usesPersonalDestination(moduleName: string) {
  return ['consumibles', 'dotacion', 'epp'].includes(normalizeMovementText(moduleName));
}

function isPersonalAseoProduct(moduleName: string, code: string) {
  // User-confirmed use: floor 5 toilet paper goes to Personal, not to its storage floor/COP.
  return normalizeMovementText(moduleName) === 'aseo' && code.toUpperCase().replace(/[^A-Z0-9]/g, '') === 'H05007';
}

function isConfirmedCopFuelWork(source: MonthlyActivitySource) {
  if (normalizeMovementText(source.module) !== 'combustible' || classifyInventoryMovementType(source.type) !== 'exit') return false;
  // User-confirmed destination for tractor washing and maintenance fuel deliveries.
  return [source.labor, source.front, source.observations, source.zone].some((value) => {
    const text = normalizeMovementText(value ?? '');
    return !/\b(?:sin|no)\b/.test(text)
      && (/\bmantenimiento\b/.test(text)
        || /\b(?:lavados?(?:\s+(?:de|del))?|lavar)\s+(?:el\s+)?tractor(?:es)?\b/.test(text)
        || /\brecogida\s+(?:(?:de|del)\s+)?personal\b/.test(text));
  });
}

function confirmedRecipientDestination(recipientName: string | undefined) {
  // User-confirmed assignments supersede the earlier individual Personal exceptions.
  // Match complete names only; do not infer destinations for other recipients.
  const name = normalizeMovementText(recipientName ?? '').replace(/\s+/g, ' ').trim();
  if (['dennys bastidas', 'dennis bastidas', 'denys bastidas', 'rafael franco'].includes(name)) return 'Vivero';
  if (name === 'pedro vizcaino') return 'COP (Centro de Operaciones)';
  return '';
}

function containsSupervisor(values: readonly (string | undefined)[]) {
  return values.some((value) => /\bsupervisor(?:es)?\b/.test(normalizeMovementText(value ?? '')));
}

function isSupervisorExit(source: MonthlyActivitySource) {
  return classifyInventoryMovementType(source.type) === 'exit'
    && containsSupervisor([
      source.destinationLot, source.observations, source.zone, source.labor, source.front,
      source.position, source.recipientId, source.recipientName,
    ]);
}

function isRouteLabel(value: string | undefined) {
  const text = normalizeMovementText(value ?? '');
  return /\brecorridos?\b/.test(text) && !/\b(?:sin|no)\s+recorridos?\b/.test(text);
}

function cleanDestination(value: string) {
  return value.split(/\s+\b(?:responsable|fecha|cargo|registro|hora)\b\s*:?/i)[0]
    .split(/\s+\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i)[0]
    .replace(/^lotes?\b\s*[:=#]?\s*/i, '').replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
}

function canonicalDestination(value: string) {
  const clean = cleanDestination(value);
  const key = normalizeMovementText(clean);
  if (!key || /^(?:n\/?a|sin (?:lote(?: de destino)?|asignar|destino)|no registrado)$/.test(key)) return '';
  if (/^(?:c\.?o\.?p\.?|centro de operaciones|cop\s*\(centro de operaciones\))$/.test(key)) return 'COP (Centro de Operaciones)';
  if (/^(?:jardin clonal|(?:lote )?ex(?:p)?erimental)$/.test(key)) return key === 'jardin clonal' ? 'Jardín clonal' : 'Experimental';
  if (/\brecorridos?\b/.test(key) || key === 'plantacion') return FUEL_ROUTE_DESTINATION;
  // Keep the lot identifiers, not the agricultural task or a trailing description.
  // A joint delivery stays in ONE joint group: never duplicate/split its cost.
  const codes = /^(\d+[a-z]?(?:\s*(?:,|\/|&|\by\b)\s*(?:lotes?\s+)?\d+[a-z]?)*)(?=$|[\s;:.(\-])/i.exec(clean)?.[1];
  if (codes) {
    const parts = [...new Set((codes.match(/\d+[a-z]?/gi) ?? []).map((code) => code.replace(/^0+(?=\d)/, '').toUpperCase()))]
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0];
  }
  return ({ taller: 'Taller', cocina: 'Cocina', comedor: 'Comedor' } as Record<string, string>)[key] || clean;
}

function isStorageFloorDestination(value: string) {
  // Storage floors are never expense destinations, regardless of module.
  return /\bpisos?\b/.test(normalizeMovementText(cleanDestination(value)));
}

function namedDestination(texts: readonly (string | undefined)[]) {
  const places = new Set<string>();
  let qualifiedPlace = false;
  for (const text of texts) {
    const normalized = normalizeMovementText(text ?? '');
    // A named place is not an amount in COP or a negated/origin reference.
    if (/\b(?:sin|no|desde|origen)\b/.test(normalized)
      || /(?:\d[\d.,\s]*\s*cop\b|\bcop\s*\$?\s*\d)/.test(normalized)) continue;
    for (const match of normalized.matchAll(/\b(?:centro de operaciones|c\.?o\.?p\.?|taller|cocina|comedor|jardin clonal|ex(?:p)?erimental|vivero)\b/g)) {
      const name = canonicalDestination(match[0]);
      // Preserve qualified locations; do not merge Taller 1 and Taller 2.
      const suffix = normalized.slice((match.index ?? 0) + match[0].length).trim();
      if (/^(?:\d|norte\b|sur\b|este\b|oeste\b|principal\b|auxiliar\b)/.test(suffix)) {
        qualifiedPlace = true;
        continue;
      }
      places.add(name);
    }
  }
  return !qualifiedPlace && places.size === 1 ? [...places][0] : '';
}

export function destinationLotOf(source: MonthlyActivitySource) {
  const recipientDestination = confirmedRecipientDestination(source.recipientName);
  if (classifyInventoryMovementType(source.type) === 'exit' && recipientDestination) return recipientDestination;
  if (classifyInventoryMovementType(source.type) === 'exit'
    && (usesPersonalDestination(source.module)
      || isPersonalAseoProduct(source.module, source.code ?? '')
      || isSupervisorExit(source))) return PERSONAL_DESTINATION;
  if (isConfirmedCopFuelWork(source)) return 'COP (Centro de Operaciones)';
  const readDestination = (value: string) => isStorageFloorDestination(value) ? '' : canonicalDestination(value);
  const explicit = readDestination(source.destinationLot ?? '');
  const destinationTexts = [source.observations, source.zone, source.labor, source.front];
  const fuelRoute = normalizeMovementText(source.module) === 'combustible'
    && (isRouteLabel(source.destinationLot) || destinationTexts.some(isRouteLabel));
  if (fuelRoute) return FUEL_ROUTE_DESTINATION;
  // El lote de fabricación y los lotes FEFO no son destinos del consumo.
  const labelled = destinationTexts.flatMap((text) => {
    const matches = (text ?? '').matchAll(/(?:\blotes?(?:\s+de\s+destino)?(?:\s*[:=#]\s*|\s+(?=[\d]))|\b(?:destino|lugar|ubicaci[oó]n|zona)\s*[:=#]\s*)([^;|\n·]+)/gi);
    return [...matches].map((match) => readDestination(match[1])).filter(Boolean);
  })[0];
  const value = explicit || labelled || namedDestination(destinationTexts);
  return value || UNKNOWN_DESTINATION_LOT;
}

// Display-only rules, including confirmed recipients: never use storage floors.
// Preserve amounts and recover other destinations only from the same movement.
export function recoverMonthlyDestinations(snapshot: MonthlyActivitySnapshot, sources: readonly MonthlyActivitySource[]) {
  const byId = new Map<string, MonthlyActivitySource | null>();
  sources.forEach((source) => byId.set(source.id, byId.has(source.id) ? null : source));
  let recoveredCount = 0;
  let discardedStorageCount = 0;
  let personalCount = 0;
  let machineryCount = 0;
  let unitCompatibilityCount = 0;
  const rows = snapshot.rows.map((originalRow) => {
    let row = originalRow;
    const source = byId.get(row.id);
    const sameMovement = source && normalizeMovementText(source.module) === normalizeMovementText(row.moduleName)
      && classifyInventoryMovementType(source.type) === row.kind && source.quantity === row.quantity
      && movementTime(source.occurredAt) === movementTime(row.occurredAt);
    if (!row.machinery?.trim() && sameMovement && source.machinery?.trim()) {
      row = { ...row, machinery: source.machinery.trim() };
      machineryCount += 1;
    }
    if (row.kind === 'exit' && row.issue === 'Unidad incompatible' && row.unitValue !== null) {
      const pricedQuantity = quantityAtPriceUnit(row.quantity, row.unit, row.priceUnit);
      if (pricedQuantity !== null) {
        row = { ...row, expense: pricedQuantity * row.unitValue, issue: '' };
        unitCompatibilityCount += 1;
      }
    }
    if (row.kind !== 'exit') return row;
    const recipientDestination = confirmedRecipientDestination(sameMovement ? source.recipientName || row.recipientName : row.recipientName);
    if (recipientDestination) {
      if (row.destinationLot === recipientDestination) return row;
      recoveredCount += 1;
      return { ...row, destinationLot: recipientDestination };
    }
    if (usesPersonalDestination(row.moduleName)
      || isPersonalAseoProduct(row.moduleName, row.code)
      || containsSupervisor([row.destinationLot, row.recipientId, row.recipientName])
      || (sameMovement && isSupervisorExit(source))) {
      if (row.destinationLot === PERSONAL_DESTINATION) return row;
      personalCount += 1;
      return { ...row, destinationLot: PERSONAL_DESTINATION };
    }
    const storageFloor = isStorageFloorDestination(row.destinationLot);
    // Explicit user correction of the 2026-08-19 Roto speed exit. Read its current
    // destination for this view, leaving the saved cut unchanged.
    const confirmedSourceCorrection = sameMovement && (row.id === '1TP0IxcXpmaG0OmKAUT1'
      || isConfirmedCopFuelWork(source)
      || (normalizeMovementText(source.module) === 'combustible'
        && [source.destinationLot, source.observations, source.zone, source.labor, source.front].some(isRouteLabel)));
    if (!storageFloor && !confirmedSourceCorrection && row.destinationLot && row.destinationLot !== UNKNOWN_DESTINATION_LOT) {
      // Old cuts retain their raw labels. Apply the same canonical lot labels as
      // newly generated months without rewriting the stored financial snapshot.
      const destinationLot = canonicalDestination(row.destinationLot) || UNKNOWN_DESTINATION_LOT;
      if (destinationLot === row.destinationLot) return row;
      recoveredCount += 1;
      return { ...row, destinationLot };
    }
    const destinationLot = sameMovement ? destinationLotOf(source) : UNKNOWN_DESTINATION_LOT;
    if (destinationLot === UNKNOWN_DESTINATION_LOT && !storageFloor) return row;
    if (destinationLot === row.destinationLot) return row;
    if (storageFloor) discardedStorageCount += 1;
    if (destinationLot !== UNKNOWN_DESTINATION_LOT) recoveredCount += 1;
    return { ...row, destinationLot };
  });
  return {
    snapshot: recoveredCount || discardedStorageCount || personalCount || machineryCount || unitCompatibilityCount ? { ...snapshot, rows } : snapshot,
    recoveredCount, discardedStorageCount, personalCount, machineryCount, unitCompatibilityCount,
  };
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
  if (/^\d+(?:,\d+)?$/.test(key)) return 'unidad';
  if (['g', 'gr', 'gramo', 'gramos'].includes(key)) return 'g';
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(key)) return 'kg';
  if (['ml', 'mililitro', 'mililitros'].includes(key)) return 'ml';
  if (['l', 'lt', 'litro', 'litros'].includes(key)) return 'l';
  if (['u', 'und', 'unidad', 'unidades'].includes(key)) return 'unidad';
  if (['par', 'pares'].includes(key)) return 'par';
  return key;
}

export function quantityAtPriceUnit(quantity: number, from: string, to: string) {
  const source = unitKey(from);
  const target = unitKey(to);
  if (source && source === target) return quantity;
  if ((source === 'unidad' && target === 'par') || (source === 'par' && target === 'unidad')) return quantity;
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
      machinery: source.machinery?.trim() || '',
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

export function formatDestinationLot(value: string) {
  const canonical = canonicalDestination(value);
  if (!canonical || canonical === UNKNOWN_DESTINATION_LOT) return UNKNOWN_DESTINATION_LOT;
  const short = canonical === 'COP (Centro de Operaciones)' ? 'COP' : canonical;
  return `Lote ${short}`;
}

function compareLotLabels(a: string, b: string) {
  const rank = (label: string) => label === UNKNOWN_DESTINATION_LOT ? 2 : /^Lote \d/.test(label) ? 0 : 1;
  return rank(a) - rank(b) || a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

export function groupMonthlyExpenses(rows: readonly MonthlyActivityRow[], by: ExpenseGrouping) {
  const groups = new Map<string, { id: string; label: string; expense: number; unpriced: number; rows: MonthlyActivityRow[] }>();
  rows.filter((row) => row.kind === 'exit' && (by !== 'person' || isPersonnelExpense(row))).forEach((row) => {
    const label = by === 'person' ? row.recipientName : by === 'lot' ? formatDestinationLot(row.destinationLot) : by === 'module' ? row.moduleName : `${row.code || 'Sin código'} · ${row.product}`;
    const id = by === 'person' ? (row.recipientId.startsWith('uid:') ? row.recipientId : normalizeMovementText(row.recipientId || label).replace(/\s+/g, ' '))
      : by === 'product' ? row.productId || JSON.stringify([row.moduleName, row.code, row.product]) : normalizeMovementText(label);
    const group = groups.get(id) ?? { id, label, expense: 0, unpriced: 0, rows: [] };
    group.expense += row.expense ?? 0;
    group.unpriced += row.expense === null ? 1 : 0;
    group.rows.push(row);
    groups.set(id, group);
  });
  return [...groups.values()].sort((a, b) => by === 'lot' ? compareLotLabels(a.label, b.label) : b.expense - a.expense || a.label.localeCompare(b.label));
}
