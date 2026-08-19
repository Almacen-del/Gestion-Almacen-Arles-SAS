import { movementDateKey, normalizeMovementText } from '../movementView';
import type {
  InventoryAnalysisIssue,
  InventoryAnalysisMovement,
  InventoryAnalysisPeriod,
  InventoryAnalysisProduct,
  InventoryMovementKind,
  InventoryPeriodAnalysis,
} from './models';

const EPSILON = 1e-7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type PreparedMovement = InventoryAnalysisMovement & {
  dateKey: string;
  chronology: number;
  delta: number | null;
  anchorIsValid: boolean;
};

type OpeningCandidate = {
  value: number;
  movementId: string;
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function dateKeyToUtc(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const result = Date.UTC(year, month, day);
  const date = new Date(result);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    return Number.NaN;
  }
  return result;
}

function chronologyValue(value: string, dateKey: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? value.replace(' ', 'T')
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : dateKeyToUtc(dateKey);
}

function movementDelta(movement: InventoryAnalysisMovement): number | null {
  if (!isFiniteNonNegative(movement.quantity)) return null;
  if (movement.kind === 'entry') return movement.quantity;
  if (movement.kind === 'exit') return -movement.quantity;
  if (movement.kind === 'transfer') return 0;
  if (
    movement.kind === 'adjustment'
    && isFiniteNonNegative(movement.stockBefore)
    && isFiniteNonNegative(movement.stockAfter)
  ) {
    return movement.stockAfter - movement.stockBefore;
  }
  return null;
}

function validateMovementAnchor(
  movement: InventoryAnalysisMovement,
  delta: number | null,
  issues: InventoryAnalysisIssue[],
) {
  const hasBefore = movement.stockBefore !== undefined && movement.stockBefore !== null;
  const hasAfter = movement.stockAfter !== undefined && movement.stockAfter !== null;
  if ((hasBefore && !isFiniteNonNegative(movement.stockBefore))
    || (hasAfter && !isFiniteNonNegative(movement.stockAfter))) {
    issues.push({
      code: 'invalid-stock-anchor',
      message: 'El movimiento contiene un saldo histórico inválido.',
      movementId: movement.id,
    });
    return false;
  }
  if (hasBefore && hasAfter && delta !== null) {
    const expected = movement.stockBefore! + delta;
    if (Math.abs(expected - movement.stockAfter!) > EPSILON) {
      issues.push({
        code: 'movement-anchor-mismatch',
        message: 'Los saldos anterior y nuevo no coinciden con la cantidad del movimiento.',
        movementId: movement.id,
      });
      return false;
    }
  }
  return true;
}

function prepareMovements(
  productId: string,
  movements: readonly InventoryAnalysisMovement[],
  issues: InventoryAnalysisIssue[],
) {
  const prepared: PreparedMovement[] = [];
  movements.filter((movement) => movement.productId === productId).forEach((movement) => {
    const dateKey = movementDateKey(movement.occurredAt);
    if (!dateKey || !Number.isFinite(dateKeyToUtc(dateKey))) {
      issues.push({
        code: 'invalid-date',
        message: 'El movimiento no tiene una fecha válida y no puede ubicarse en el histórico.',
        movementId: movement.id,
      });
      return;
    }
    const delta = movementDelta(movement);
    if (!isFiniteNonNegative(movement.quantity)) {
      issues.push({
        code: 'invalid-quantity',
        message: 'El movimiento tiene una cantidad inválida.',
        movementId: movement.id,
      });
    }
    prepared.push({
      ...movement,
      dateKey,
      chronology: chronologyValue(movement.occurredAt, dateKey),
      delta,
      anchorIsValid: validateMovementAnchor(movement, delta, issues),
    });
  });
  return prepared.sort((left, right) => left.chronology - right.chronology || left.id.localeCompare(right.id));
}

function sumKnownDeltas(movements: readonly PreparedMovement[]) {
  let total = 0;
  for (const movement of movements) {
    if (movement.delta === null) return null;
    total += movement.delta;
  }
  return total;
}

function openingCandidates(movements: readonly PreparedMovement[], from: string) {
  const candidates: OpeningCandidate[] = [];
  movements.forEach((movement, index) => {
    if (!movement.anchorIsValid) return;
    const beforePeriod = movement.dateKey < from;
    if (isFiniteNonNegative(movement.stockBefore)) {
      const path = beforePeriod
        ? movements.slice(index).filter((entry) => entry.dateKey < from)
        : movements.slice(0, index).filter((entry) => entry.dateKey >= from);
      const delta = sumKnownDeltas(path);
      if (delta !== null) {
        candidates.push({
          value: beforePeriod ? movement.stockBefore + delta : movement.stockBefore - delta,
          movementId: movement.id,
        });
      }
    }
    if (isFiniteNonNegative(movement.stockAfter)) {
      const path = beforePeriod
        ? movements.slice(index + 1).filter((entry) => entry.dateKey < from)
        : movements.slice(0, index + 1).filter((entry) => entry.dateKey >= from);
      const delta = sumKnownDeltas(path);
      if (delta !== null) {
        candidates.push({
          value: beforePeriod ? movement.stockAfter + delta : movement.stockAfter - delta,
          movementId: movement.id,
        });
      }
    }
  });
  return candidates;
}

function uniqueIssueList(issues: readonly InventoryAnalysisIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.movementId ?? ''}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveOpeningInventory(
  candidates: readonly OpeningCandidate[],
  issues: InventoryAnalysisIssue[],
) {
  if (candidates.length === 0) {
    issues.push({
      code: 'missing-balance-anchor',
      message: 'No existe un saldo histórico trazable para reconstruir el inventario inicial.',
    });
    return null;
  }
  const reference = candidates[0].value;
  if (candidates.some((candidate) => Math.abs(candidate.value - reference) > EPSILON)) {
    issues.push({
      code: 'conflicting-balance-anchors',
      message: 'Dos o más saldos históricos producen inventarios iniciales diferentes.',
    });
    return null;
  }
  if (reference < -EPSILON) {
    issues.push({
      code: 'negative-balance',
      message: 'La reconstrucción histórica produce un inventario inicial negativo.',
    });
    return null;
  }
  return Math.abs(reference) <= EPSILON ? 0 : reference;
}

function qualityFromIssues(issues: readonly InventoryAnalysisIssue[]) {
  if (issues.some((issue) => [
    'movement-anchor-mismatch',
    'conflicting-balance-anchors',
    'negative-balance',
    'current-stock-mismatch',
  ].includes(issue.code))) return 'inconsistent' as const;
  if (issues.length > 0) return 'insufficient' as const;
  return 'exact' as const;
}

function lastMovementOfKind(
  movements: readonly PreparedMovement[],
  kind: 'entry' | 'exit',
  cutoff: string,
) {
  return [...movements]
    .reverse()
    .find((movement) => movement.kind === kind && movement.dateKey <= cutoff) ?? null;
}

export function classifyInventoryMovementType(rawType: string): InventoryMovementKind {
  const type = normalizeMovementText(rawType);
  if (type.includes('traslado')) return 'transfer';
  if (type.includes('entrada') || type.includes('ingreso')) return 'entry';
  if (type.includes('salida') || type.includes('entrega') || type.includes('consumo')) return 'exit';
  if (type.includes('ajuste')) return 'adjustment';
  return 'unknown';
}

export function analyzeInventoryPeriod(
  product: InventoryAnalysisProduct,
  movements: readonly InventoryAnalysisMovement[],
  period: InventoryAnalysisPeriod,
): InventoryPeriodAnalysis {
  const issues: InventoryAnalysisIssue[] = [];
  const fromUtc = dateKeyToUtc(period.from);
  const toUtc = dateKeyToUtc(period.to);
  const periodIsValid = Number.isFinite(fromUtc) && Number.isFinite(toUtc) && fromUtc <= toUtc;
  if (!periodIsValid) {
    issues.push({ code: 'invalid-period', message: 'El período consultado no es válido.' });
  }
  const coverageFromUtc = period.historyCoverageFrom
    ? dateKeyToUtc(period.historyCoverageFrom)
    : Number.NaN;
  const startsBeforeKnownHistory = periodIsValid
    && Number.isFinite(coverageFromUtc)
    && fromUtc < coverageFromUtc;
  if (startsBeforeKnownHistory) {
    issues.push({
      code: 'period-before-history-coverage',
      message: `El período comienza antes de la cobertura histórica disponible (${period.historyCoverageFrom}).`,
    });
  }

  const prepared = prepareMovements(product.id, movements, issues);
  const inPeriod = periodIsValid
    ? prepared.filter((movement) => movement.dateKey >= period.from && movement.dateKey <= period.to)
    : [];
  const entryMovements = inPeriod.filter((movement) => movement.kind === 'entry' && movement.delta !== null);
  const exitMovements = inPeriod.filter((movement) => movement.kind === 'exit' && movement.delta !== null);
  const otherMovements = inPeriod.filter((movement) => movement.kind === 'transfer' || movement.kind === 'adjustment');
  const entries = entryMovements.reduce((total, movement) => total + movement.quantity, 0);
  const exits = exitMovements.reduce((total, movement) => total + movement.quantity, 0);
  const periodDelta = sumKnownDeltas(inPeriod);
  const knownEntryExitDelta = entries - exits;
  const otherChanges = periodDelta === null ? null : periodDelta - knownEntryExitDelta;

  if (periodIsValid && periodDelta === null) {
    issues.push({
      code: 'incomplete-balance-path',
      message: 'Hay movimientos del período que no permiten reconstruir el saldo con exactitud.',
    });
  }

  const candidates = periodIsValid && !startsBeforeKnownHistory ? openingCandidates(prepared, period.from) : [];
  const openingInventory = periodIsValid && !startsBeforeKnownHistory
    ? resolveOpeningInventory(candidates, issues)
    : null;
  const closingCandidate = openingInventory !== null && periodDelta !== null
    ? openingInventory + periodDelta
    : null;
  let closingInventory = closingCandidate;
  if (closingCandidate !== null && closingCandidate < -EPSILON) {
    issues.push({
      code: 'negative-balance',
      message: 'La reconstrucción histórica produce un inventario final negativo.',
    });
    closingInventory = null;
  } else if (closingCandidate !== null && Math.abs(closingCandidate) <= EPSILON) {
    closingInventory = 0;
  }

  const averageInventory = openingInventory !== null && closingInventory !== null
    ? (openingInventory + closingInventory) / 2
    : null;
  const turnover = averageInventory !== null && Math.abs(averageInventory) > EPSILON
    ? exits / averageInventory
    : null;
  const lastEntry = periodIsValid ? lastMovementOfKind(prepared, 'entry', period.to) : null;
  const lastExit = periodIsValid ? lastMovementOfKind(prepared, 'exit', period.to) : null;
  const daysWithoutMovement = lastExit && periodIsValid
    ? Math.floor((toUtc - dateKeyToUtc(lastExit.dateKey)) / DAY_IN_MS)
    : null;
  const finalIssues = uniqueIssueList(issues);

  return {
    product,
    period,
    openingInventory,
    entries,
    exits,
    otherChanges,
    closingInventory,
    averageInventory,
    turnover,
    lastEntryDate: lastEntry?.dateKey ?? null,
    lastExitDate: lastExit?.dateKey ?? null,
    daysWithoutMovement,
    quality: qualityFromIssues(finalIssues),
    issues: finalIssues,
    evidence: {
      openingAnchorMovementIds: [...new Set(candidates.map((candidate) => candidate.movementId))],
      entryMovementIds: entryMovements.map((movement) => movement.id),
      exitMovementIds: exitMovements.map((movement) => movement.id),
      otherMovementIds: otherMovements.map((movement) => movement.id),
      lastEntryMovementId: lastEntry?.id ?? null,
      lastExitMovementId: lastExit?.id ?? null,
    },
  };
}

export function validateCurrentStockAtCutoff(
  analysis: InventoryPeriodAnalysis,
  currentStock: number | null | undefined,
  cutoffIsCurrent: boolean,
): InventoryPeriodAnalysis {
  if (
    !cutoffIsCurrent
    || !isFiniteNonNegative(currentStock)
    || analysis.closingInventory === null
    || Math.abs(analysis.closingInventory - currentStock) <= EPSILON
  ) return analysis;

  const issue: InventoryAnalysisIssue = {
    code: 'current-stock-mismatch',
    message: `El cierre reconstruido (${analysis.closingInventory}) no coincide con el stock actual confirmado (${currentStock}).`,
  };
  const issues = uniqueIssueList([...analysis.issues, issue]);
  return { ...analysis, quality: qualityFromIssues(issues), issues };
}
