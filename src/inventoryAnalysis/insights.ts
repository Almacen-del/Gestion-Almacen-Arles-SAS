import type { InventoryAnalysisThresholds, InventoryClassification, InventoryPeriodAnalysis } from './models';

export type InventoryInsightKind = 'data' | 'trend' | 'alert';

export type InventoryInsight = {
  kind: InventoryInsightKind;
  title: string;
  message: string;
};

export type ClassifiedInventoryAnalysis = InventoryPeriodAnalysis & {
  classification: InventoryClassification;
};

function statusCount(rows: readonly ClassifiedInventoryAnalysis[], status: InventoryClassification['status']) {
  return rows.filter((row) => row.classification.status === status).length;
}

export function buildProductInventoryInsights(
  current: ClassifiedInventoryAnalysis,
  monthlyHistory: readonly InventoryPeriodAnalysis[],
  thresholds: InventoryAnalysisThresholds,
): InventoryInsight[] {
  const insights: InventoryInsight[] = [];
  if (current.quality !== 'exact') {
    insights.push({
      kind: 'alert',
      title: 'Revisión de datos',
      message: 'El histórico disponible no permite considerar exactos todos los indicadores de este producto.',
    });
  }

  if (current.lastExitDate === null) {
    insights.push({ kind: 'data', title: 'Sin salidas', message: 'No existen salidas registradas hasta la fecha de corte.' });
  } else if (current.daysWithoutMovement !== null) {
    insights.push({
      kind: 'data',
      title: 'Días sin movimiento',
      message: `El producto acumula ${current.daysWithoutMovement} días desde su última salida válida.`,
    });
  }

  if (current.classification.status === 'possible-obsolescence') {
    insights.push({
      kind: 'alert',
      title: 'Obsolescencia',
      message: 'El producto cumple los límites configurados de obsolescencia y requiere revisión; no se marcó como obsoleto confirmado.',
    });
  }

  const exactPeriods = monthlyHistory.filter((entry) => entry.quality === 'exact');
  const recent = exactPeriods.slice(-3);
  if (
    recent.length === 3
    && recent[0].exits > recent[1].exits
    && recent[1].exits > recent[2].exits
  ) {
    insights.push({
      kind: 'trend',
      title: 'Disminución de movimiento',
      message: `Las salidas disminuyeron en los últimos tres períodos calculables: ${recent.map((entry) => entry.exits).join(' → ')}.`,
    });
  }

  const previous = exactPeriods.at(-2);
  if (
    current.exits > 0
    && previous?.daysWithoutMovement !== null
    && previous?.daysWithoutMovement !== undefined
    && previous.daysWithoutMovement >= thresholds.noMovementAfterDays
  ) {
    insights.push({
      kind: 'trend',
      title: 'Recuperación de movimiento',
      message: 'El producto volvió a registrar salidas después de superar el límite configurado de días sin movimiento.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      kind: 'data',
      title: 'Sin alertas adicionales',
      message: 'Los datos calculados no muestran una tendencia o alerta adicional para este período.',
    });
  }
  return insights;
}

export function buildWarehouseInventorySummary(
  current: readonly ClassifiedInventoryAnalysis[],
  previous: readonly ClassifiedInventoryAnalysis[],
) {
  const currentCounts = {
    products: current.length,
    normal: statusCount(current, 'normal'),
    lowTurnover: statusCount(current, 'low-turnover'),
    noMovement: statusCount(current, 'no-movement'),
    neverMoved: statusCount(current, 'never-moved'),
    outOfStock: statusCount(current, 'out-of-stock'),
    possibleObsolescence: statusCount(current, 'possible-obsolescence'),
    review: statusCount(current, 'review'),
  };
  const previousCounts = {
    products: previous.length,
    normal: statusCount(previous, 'normal'),
    lowTurnover: statusCount(previous, 'low-turnover'),
    noMovement: statusCount(previous, 'no-movement'),
    neverMoved: statusCount(previous, 'never-moved'),
    outOfStock: statusCount(previous, 'out-of-stock'),
    possibleObsolescence: statusCount(previous, 'possible-obsolescence'),
    review: statusCount(previous, 'review'),
  };
  const longestWithoutMovement = [...current]
    .filter((row) => row.daysWithoutMovement !== null)
    .sort((left, right) => (right.daysWithoutMovement ?? 0) - (left.daysWithoutMovement ?? 0))
    .slice(0, 3)
    .map((row) => ({
      product: row.product.name,
      code: row.product.code,
      days: row.daysWithoutMovement!,
    }));

  return {
    current: currentCounts,
    previous: previousCounts,
    differences: {
      normal: currentCounts.normal - previousCounts.normal,
      lowTurnover: currentCounts.lowTurnover - previousCounts.lowTurnover,
      noMovement: currentCounts.noMovement - previousCounts.noMovement,
      neverMoved: currentCounts.neverMoved - previousCounts.neverMoved,
      outOfStock: currentCounts.outOfStock - previousCounts.outOfStock,
      possibleObsolescence: currentCounts.possibleObsolescence - previousCounts.possibleObsolescence,
      review: currentCounts.review - previousCounts.review,
    },
    longestWithoutMovement,
  };
}
