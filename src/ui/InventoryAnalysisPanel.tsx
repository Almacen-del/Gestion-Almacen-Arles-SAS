import ColumnFilterTable from './ColumnFilterTable';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarDays, PackageSearch, RotateCcw, Settings2, TrendingUp, X } from 'lucide-react';
import {
  buildAgrochemicalEntryQueue,
  daysUntilExpiration,
  type AgrochemicalLot,
  type AgrochemicalStockEntry,
} from '../agrochemicalLots';
import { classifyInventoryAnalysis } from '../inventoryAnalysis/classification';
import { analyzeInventoryPeriod, reconcileCurrentStockAtCutoff } from '../inventoryAnalysis/engine';
import { movementDateKey } from '../movementView';
import {
  loadInventoryAnalysisThresholds,
  saveInventoryAnalysisThresholds,
} from '../inventoryAnalysis/settings';
import { adaptInventoryAnalysisSources } from '../inventoryAnalysis/sourceAdapter';
import { buildProductInventoryInsights } from '../inventoryAnalysis/insights';
import type {
  InventoryAnalysisSourceMovement,
  InventoryAnalysisSourceProduct,
} from '../inventoryAnalysis/sourceAdapter';
import type {
  InventoryAnalysisThresholds,
  InventoryClassificationStatus,
  InventoryPeriodAnalysis,
} from '../inventoryAnalysis/models';

type AnalysisRow = InventoryPeriodAnalysis & {
  classification: ReturnType<typeof classifyInventoryAnalysis>;
};

type SortKey = 'days' | 'turnover' | 'never-moved' | 'product';

const STATUS_OPTIONS: Array<{ value: InventoryClassificationStatus | ''; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'normal', label: 'Movimiento normal' },
  { value: 'low-turnover', label: 'Baja rotación' },
  { value: 'no-movement', label: 'Sin movimiento reciente' },
  { value: 'never-moved', label: 'Sin movimientos' },
  { value: 'out-of-stock', label: 'Sin existencias' },
  { value: 'review', label: 'Revisar' },
  { value: 'possible-obsolescence', label: 'Obsolescencia' },
  { value: 'confirmed-obsolete', label: 'Obsoleto confirmado' },
];

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonthPeriod() {
  const now = new Date();
  return {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    from: localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: localDateKey(now),
  };
}

function monthPeriod(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && monthIndex === now.getMonth();
  return {
    from: localDateKey(new Date(year, monthIndex, 1)),
    to: isCurrentMonth ? localDateKey(now) : localDateKey(new Date(year, monthIndex + 1, 0)),
  };
}

function formatQuantity(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
}

function formatTurnover(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function normalized(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function statusCount(rows: readonly AnalysisRow[], status: InventoryClassificationStatus) {
  return rows.filter((row) => row.classification.status === status).length;
}

function monthlyPeriodsEndingAt(cutoff: string, count = 12) {
  const match = cutoff.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const cutoffYear = Number(match[1]);
  const cutoffMonth = Number(match[2]) - 1;
  return Array.from({ length: count }, (_, index) => {
    const offset = count - index - 1;
    const start = new Date(cutoffYear, cutoffMonth - offset, 1);
    const end = new Date(cutoffYear, cutoffMonth - offset + 1, 0);
    const from = localDateKey(start);
    const naturalTo = localDateKey(end);
    return {
      label: new Intl.DateTimeFormat('es-CO', { month: 'short', year: 'numeric' }).format(start),
      from,
      to: offset === 0 && cutoff < naturalTo ? cutoff : naturalTo,
    };
  });
}

export default function InventoryAnalysisPanel({
  sourceProducts,
  sourceMovements,
  expirationLots,
  agrochemicalEntries,
  historyComplete,
  loadingHistory,
  onLoadCompleteHistory,
}: {
  sourceProducts: readonly InventoryAnalysisSourceProduct[];
  sourceMovements: readonly InventoryAnalysisSourceMovement[];
  expirationLots: readonly AgrochemicalLot[];
  agrochemicalEntries: readonly AgrochemicalStockEntry[];
  historyComplete: boolean;
  loadingHistory: boolean;
  onLoadCompleteHistory: () => Promise<void>;
}) {
  const initialPeriod = useMemo(currentMonthPeriod, []);
  const [month, setMonth] = useState(initialPeriod.month);
  const [dateFrom, setDateFrom] = useState(initialPeriod.from);
  const [dateTo, setDateTo] = useState(initialPeriod.to);
  const [moduleFilter, setModuleFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<InventoryClassificationStatus | ''>('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<InventoryAnalysisThresholds>(() => (
    loadInventoryAnalysisThresholds(window.localStorage)
  ));

  const adapted = useMemo(() => adaptInventoryAnalysisSources(sourceProducts, sourceMovements), [
    sourceMovements,
    sourceProducts,
  ]);
  const excludedMovementDetails = useMemo(() => {
    const movementById = new Map(sourceMovements.map((movement) => [movement.id, movement]));
    return {
      unresolved: adapted.unresolvedMovementIds.flatMap((id) => {
        const movement = movementById.get(id);
        return movement ? [movement] : [];
      }),
      ambiguous: adapted.ambiguousMovementIds.flatMap((id) => {
        const movement = movementById.get(id);
        return movement ? [movement] : [];
      }),
    };
  }, [adapted.ambiguousMovementIds, adapted.unresolvedMovementIds, sourceMovements]);
  const excludedMovementCount = adapted.unresolvedMovementIds.length + adapted.ambiguousMovementIds.length;
  const excludedMovementSummary = [
    adapted.unresolvedMovementIds.length > 0
      ? `${adapted.unresolvedMovementIds.length} ${adapted.unresolvedMovementIds.length === 1 ? 'movimiento' : 'movimientos'} sin producto identificable`
      : '',
    adapted.ambiguousMovementIds.length > 0
      ? `${adapted.ambiguousMovementIds.length} ${adapted.ambiguousMovementIds.length === 1 ? 'movimiento ambiguo' : 'movimientos ambiguos'}`
      : '',
  ].filter(Boolean).join(' y ');
  const historyCoverageFrom = useMemo(() => sourceMovements
    .map((movement) => movementDateKey(movement.occurredAt))
    .filter(Boolean)
    .sort()[0] ?? '', [sourceMovements]);
  const [currentDate, setCurrentDate] = useState(() => localDateKey(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextDate = localDateKey(new Date());
      setCurrentDate((previousDate) => {
        if (nextDate !== previousDate) {
          setDateTo((currentDateTo) => currentDateTo === previousDate ? nextDate : currentDateTo);
        }
        return nextDate;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const allRows = useMemo<AnalysisRow[]>(() => {
    if (!historyComplete || !dateFrom || !dateTo || dateFrom > dateTo) return [];
    return adapted.products.map((product) => {
      const calculated = analyzeInventoryPeriod(product, adapted.movements, {
        from: dateFrom,
        to: dateTo,
        historyCoverageFrom,
      });
      const analysis = reconcileCurrentStockAtCutoff(
        calculated,
        product.currentStock,
        dateTo === currentDate,
      );
      return { ...analysis, classification: classifyInventoryAnalysis(analysis, thresholds) };
    });
  }, [adapted.movements, adapted.products, currentDate, dateFrom, dateTo, historyComplete, historyCoverageFrom, thresholds]);
  const moduleOptions = useMemo(() => [...new Set(adapted.products.map((product) => product.module))].sort(), [adapted.products]);
  const categoryOptions = useMemo(() => [...new Set(adapted.products
    .filter((product) => !moduleFilter || product.module === moduleFilter)
    .map((product) => product.category))].sort(), [adapted.products, moduleFilter]);
  const locationOptions = useMemo(() => [...new Set(adapted.products
    .map((product) => product.location ?? '')
    .filter(Boolean))].sort(), [adapted.products]);

  const rows = useMemo(() => {
    const query = normalized(search);
    return allRows
      .filter((row) => !moduleFilter || row.product.module === moduleFilter)
      .filter((row) => !categoryFilter || row.product.category === categoryFilter)
      .filter((row) => !locationFilter || row.product.location === locationFilter)
      .filter((row) => !statusFilter || row.classification.status === statusFilter)
      .filter((row) => !query || normalized(`${row.product.code} ${row.product.name}`).includes(query))
      .sort((left, right) => {
        if (sortKey === 'product') return left.product.name.localeCompare(right.product.name);
        if (sortKey === 'turnover') return (right.turnover ?? -1) - (left.turnover ?? -1);
        if (sortKey === 'never-moved') {
          const leftNeverMoved = left.classification.status === 'never-moved' ? 0 : 1;
          const rightNeverMoved = right.classification.status === 'never-moved' ? 0 : 1;
          return leftNeverMoved - rightNeverMoved || left.product.name.localeCompare(right.product.name);
        }
        return (right.daysWithoutMovement ?? -1) - (left.daysWithoutMovement ?? -1);
      });
  }, [allRows, categoryFilter, locationFilter, moduleFilter, search, sortKey, statusFilter]);
  const topTurnover = useMemo(() => rows.filter((row) => row.turnover !== null)
    .sort((left, right) => (right.turnover ?? 0) - (left.turnover ?? 0)).slice(0, 10), [rows]);
  const longestWithoutMovement = useMemo(() => rows.filter((row) => row.daysWithoutMovement !== null)
    .sort((left, right) => (right.daysWithoutMovement ?? 0) - (left.daysWithoutMovement ?? 0)).slice(0, 10), [rows]);
  const lowestTurnover = useMemo(() => rows
    .filter((row) => row.closingInventory !== null && row.closingInventory > 0 && row.turnover !== null)
    .sort((left, right) => (left.turnover ?? 0) - (right.turnover ?? 0)).slice(0, 10), [rows]);
  const possibleObsolescence = useMemo(() => rows
    .filter((row) => row.classification.status === 'possible-obsolescence')
    .slice(0, 10), [rows]);
  const nearExpiryLots = useMemo(() => {
    const productById = new Map(sourceProducts.map((product) => [product.id, product]));
    const query = normalized(search);
    return expirationLots
      .map((lot) => ({ lot, product: productById.get(lot.productDocumentId), days: daysUntilExpiration(lot.expirationDate, dateTo) }))
      .filter((entry) => entry.product && entry.lot.quantity > 0 && entry.days !== null && entry.days >= 0 && entry.days <= thresholds.nearExpiryDays)
      .filter((entry) => !moduleFilter || entry.product?.module === moduleFilter)
      .filter((entry) => !categoryFilter || entry.product?.category === categoryFilter)
      .filter((entry) => !locationFilter || entry.product?.location === locationFilter)
      .filter((entry) => !query || normalized(`${entry.product?.code ?? ''} ${entry.product?.name ?? ''} ${entry.lot.lotNumber}`).includes(query))
      .sort((left, right) => (left.days ?? Number.POSITIVE_INFINITY) - (right.days ?? Number.POSITIVE_INFINITY));
  }, [categoryFilter, dateTo, expirationLots, locationFilter, moduleFilter, search, sourceProducts, thresholds.nearExpiryDays]);
  const nearExpiryProductCount = useMemo(() => new Set(
    nearExpiryLots.map((entry) => entry.lot.productDocumentId),
  ).size, [nearExpiryLots]);
  const expiredLots = useMemo(() => {
    const productById = new Map(sourceProducts.map((product) => [product.id, product]));
    const query = normalized(search);
    return expirationLots
      .map((lot) => ({ lot, product: productById.get(lot.productDocumentId), days: daysUntilExpiration(lot.expirationDate, dateTo) }))
      .filter((entry) => entry.product && entry.lot.quantity > 0 && entry.days !== null && entry.days < 0)
      .filter((entry) => !moduleFilter || entry.product?.module === moduleFilter)
      .filter((entry) => !categoryFilter || entry.product?.category === categoryFilter)
      .filter((entry) => !locationFilter || entry.product?.location === locationFilter)
      .filter((entry) => !query || normalized(`${entry.product?.code ?? ''} ${entry.product?.name ?? ''} ${entry.lot.lotNumber}`).includes(query))
      .sort((left, right) => (left.days ?? 0) - (right.days ?? 0));
  }, [categoryFilter, dateTo, expirationLots, locationFilter, moduleFilter, search, sourceProducts]);
  const pendingLotAssignments = useMemo(() => buildAgrochemicalEntryQueue(
    agrochemicalEntries,
    expirationLots,
  ).filter((entry) => entry.assignmentStatus !== 'assigned'), [agrochemicalEntries, expirationLots]);
  const hasExpirationData = rows.some((row) => Boolean(row.product.expirationDate));
  const selectedRow = allRows.find((row) => row.product.id === selectedProductId) ?? null;
  const selectedHistory = useMemo(() => {
    if (!selectedRow) return [];
    return monthlyPeriodsEndingAt(dateTo).map((period) => {
      const calculated = analyzeInventoryPeriod(selectedRow.product, adapted.movements, {
        ...period,
        historyCoverageFrom,
      });
      const analysis = reconcileCurrentStockAtCutoff(
        calculated,
        selectedRow.product.currentStock,
        period.to === currentDate,
      );
      return { label: period.label, ...analysis };
    });
  }, [adapted.movements, currentDate, dateTo, historyCoverageFrom, selectedRow]);
  const selectedEvidenceMovements = useMemo(() => {
    if (!selectedRow) return [];
    const evidenceIds = new Set([
      ...selectedRow.evidence.openingAnchorMovementIds,
      ...selectedRow.evidence.entryMovementIds,
      ...selectedRow.evidence.exitMovementIds,
      ...selectedRow.evidence.otherMovementIds,
    ]);
    return sourceMovements
      .filter((movement) => evidenceIds.has(movement.id))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }, [selectedRow, sourceMovements]);
  const historyMax = useMemo(() => Math.max(1, ...selectedHistory.flatMap((entry) => [
    entry.exits,
    entry.daysWithoutMovement ?? 0,
    (entry.turnover ?? 0) * 10,
  ])), [selectedHistory]);
  const selectedInsights = useMemo(() => selectedRow
    ? buildProductInventoryInsights(selectedRow, selectedHistory, thresholds)
    : [], [selectedHistory, selectedRow, thresholds]);

  function updateMonth(value: string) {
    setMonth(value);
    const period = monthPeriod(value);
    if (period) {
      setDateFrom(period.from);
      setDateTo(period.to);
    }
  }

  function updateThreshold(key: keyof InventoryAnalysisThresholds, value: string) {
    const next = saveInventoryAnalysisThresholds(window.localStorage, {
      ...thresholds,
      [key]: Number(value),
    });
    setThresholds(next);
  }

  if (!historyComplete) {
    return (
      <section className="analysis-loading-panel">
        <BarChart3 size={34} />
        <h2>Preparando indicadores trazables</h2>
        <p>El análisis necesita el historial completo. No se mostrarán cifras con una carga parcial.</p>
        <button type="button" disabled={loadingHistory} onClick={() => { void onLoadCompleteHistory(); }}>
          {loadingHistory ? 'Cargando historial completo…' : 'Cargar historial completo'}
        </button>
      </section>
    );
  }

  return (
    <section className="inventory-analysis" aria-label="Indicadores de inventario">
      {(adapted.unresolvedMovementIds.length > 0 || adapted.ambiguousMovementIds.length > 0) && (
        <div className="analysis-data-warning">
          <AlertTriangle size={18} />
          <div className="analysis-data-warning-content">
            <span>
              {excludedMovementSummary} {excludedMovementCount === 1 ? 'quedó' : 'quedaron'} fuera del cálculo para evitar asignaciones inventadas.
            </span>
            <details>
              <summary>Ver cuáles son y por qué</summary>
              <div className="analysis-excluded-movements">
                {excludedMovementDetails.unresolved.length > 0 && <section>
                  <strong>Sin producto identificable ({excludedMovementDetails.unresolved.length})</strong>
                  <small>No coinciden con ningún producto actual por documento, código ni descripción.</small>
                  <ul>{excludedMovementDetails.unresolved.map((movement) => <li key={movement.id}><b>{movement.code || 'Sin código'} · {movement.name}</b><span>{movement.module} · {movement.type} · {movement.occurredAt || 'Sin fecha'} · ID {movement.id}</span></li>)}</ul>
                </section>}
                {excludedMovementDetails.ambiguous.length > 0 && <section>
                  <strong>Ambiguos ({excludedMovementDetails.ambiguous.length})</strong>
                  <small>Coinciden con más de un producto actual, por lo que no se puede elegir uno sin inventar la asignación.</small>
                  <ul>{excludedMovementDetails.ambiguous.map((movement) => <li key={movement.id}><b>{movement.code || 'Sin código'} · {movement.name}</b><span>{movement.module} · {movement.type} · {movement.occurredAt || 'Sin fecha'} · ID {movement.id}</span></li>)}</ul>
                </section>}
              </div>
            </details>
          </div>
        </div>
      )}

      <section className="analysis-controls">
        <label><span>Mes</span><input type="month" value={month} onChange={(event) => updateMonth(event.target.value)} /></label>
        <label><span>Desde</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>Hasta</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label><span>Módulo</span><select value={moduleFilter} onChange={(event) => { setModuleFilter(event.target.value); setCategoryFilter(''); }}><option value="">Todos</option>{moduleOptions.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label><span>Categoría</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas</option>{categoryOptions.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        {locationOptions.length > 0 && <label><span>Ubicación</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">Todas</option>{locationOptions.map((entry) => <option key={entry}>{entry}</option>)}</select></label>}
        <label className="analysis-search"><span>Producto o código</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" /></label>
        <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InventoryClassificationStatus | '')}>{STATUS_OPTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label>
        <button className="analysis-settings-button" type="button" onClick={() => setSettingsOpen((value) => !value)}><Settings2 size={17} /> Límites</button>
      </section>

      {settingsOpen && (
        <section className="analysis-settings" aria-label="Configuración de límites">
          <label>Rotación máxima baja<input type="number" min="0" step="0.01" value={thresholds.lowTurnoverMaximum} onChange={(event) => updateThreshold('lowTurnoverMaximum', event.target.value)} /></label>
          <label>Días para baja rotación<input type="number" min="0" value={thresholds.lowTurnoverAfterDays} onChange={(event) => updateThreshold('lowTurnoverAfterDays', event.target.value)} /></label>
          <label>Días sin movimiento<input type="number" min="0" value={thresholds.noMovementAfterDays} onChange={(event) => updateThreshold('noMovementAfterDays', event.target.value)} /></label>
          <label>Días para obsolescencia<input type="number" min="0" value={thresholds.possibleObsolescenceAfterDays} onChange={(event) => updateThreshold('possibleObsolescenceAfterDays', event.target.value)} /></label>
          <label>Días de próximo vencimiento<input type="number" min="0" value={thresholds.nearExpiryDays} onChange={(event) => updateThreshold('nearExpiryDays', event.target.value)} /></label>
          <small>Estos límites se guardan en este equipo y pueden cambiarse sin modificar el programa.</small>
        </section>
      )}

      <section className="analysis-kpis">
        <article><PackageSearch size={19} /><span>Productos analizados</span><strong>{rows.length}</strong></article>
        <article><RotateCcw size={19} /><span>Movimiento normal</span><strong>{statusCount(rows, 'normal')}</strong></article>
        <article><BarChart3 size={19} /><span>Baja rotación</span><strong>{statusCount(rows, 'low-turnover')}</strong></article>
        <article><CalendarDays size={19} /><span>Sin movimiento reciente</span><strong>{statusCount(rows, 'no-movement')}</strong></article>
        <article><PackageSearch size={19} /><span>Sin movimientos</span><strong>{statusCount(rows, 'never-moved')}</strong></article>
        <article><PackageSearch size={19} /><span>Sin existencias</span><strong>{statusCount(rows, 'out-of-stock')}</strong></article>
        <article><AlertTriangle size={19} /><span>Obsolescencia</span><strong>{statusCount(rows, 'possible-obsolescence')}</strong><small className="analysis-kpi-detail">{statusCount(rows, 'possible-obsolescence')} productos · {expiredLots.length} lotes</small></article>
        <article><CalendarDays size={19} /><span>Productos próximos a vencer en {thresholds.nearExpiryDays} días</span><strong>{nearExpiryProductCount}</strong></article>
        <article><AlertTriangle size={19} /><span>Obsoletos confirmados</span><strong>{statusCount(rows, 'confirmed-obsolete')}</strong></article>
        <article><AlertTriangle size={19} /><span>Revisar / sin datos suficientes</span><strong>{statusCount(rows, 'review')}</strong></article>
      </section>

      <aside className="analysis-rotation-note" aria-label="Guía del índice de rotación">
        <strong>Rotación</strong>
        <div>
          <span><b>2,00:</b> Alta</span>
          <span><b>1,50:</b> Media-alta</span>
          <span><b>1,00:</b> Media</span>
          <span><b>0,50:</b> Baja</span>
          <span><b>0,00:</b> Nula</span>
        </div>
      </aside>

      <section className="analysis-ranking-grid">
        <article className="analysis-ranking"><h3>Mayor rotación</h3>{topTurnover.length === 0 ? <p>Sin resultados calculables.</p> : <ol>{topTurnover.map((row) => <li key={row.product.id}><span>{row.product.code} · {row.product.name}</span><strong>{formatTurnover(row.turnover)}</strong></li>)}</ol>}</article>
        <article className="analysis-ranking"><h3>Más días sin movimiento</h3>{longestWithoutMovement.length === 0 ? <p>Sin salidas históricas fechadas.</p> : <ol>{longestWithoutMovement.map((row) => <li key={row.product.id}><span>{row.product.code} · {row.product.name}</span><strong>{row.daysWithoutMovement} días</strong></li>)}</ol>}</article>
        <article className="analysis-ranking"><h3>Menor rotación con stock</h3>{lowestTurnover.length === 0 ? <p>Sin resultados calculables.</p> : <ol>{lowestTurnover.map((row) => <li key={row.product.id}><span>{row.product.code} · {row.product.name}</span><strong>{formatTurnover(row.turnover)}</strong></li>)}</ol>}</article>
        <article className="analysis-ranking"><h3>Obsolescencia · {expiredLots.length} lotes vencidos</h3>{possibleObsolescence.length === 0 ? <p>Ningún producto supera los límites configurados.</p> : <ol>{expiredLots.slice(0, 10).map(({ lot, product }) => <li key={`${lot.productDocumentId}-${lot.id}`}><span>{product?.code} · {product?.name} · Lote {lot.lotNumber}</span><strong>{formatQuantity(lot.quantity)} {lot.unit} · FV {lot.expirationDate}</strong></li>)}{possibleObsolescence.filter((row) => !row.classification.expired).slice(0, Math.max(0, 10 - expiredLots.length)).map((row) => <li key={row.product.id}><span>{row.product.code} · {row.product.name} · Sin lote vencido</span><strong>{formatQuantity(row.product.currentStock ?? null)} {row.product.unit} · {row.daysWithoutMovement ?? 'N/A'} días</strong></li>)}</ol>}</article>
        <article className="analysis-ranking"><h3>Lotes próximos a vencer en {thresholds.nearExpiryDays} días</h3>{nearExpiryLots.length === 0 ? <p>No hay lotes próximos a vencer.</p> : <ol>{nearExpiryLots.slice(0, 10).map(({ lot, product, days }) => <li key={`${lot.productDocumentId}-${lot.id}`}><span>{product?.code} · {product?.name} · Lote {lot.lotNumber}</span><strong>{formatQuantity(lot.quantity)} {lot.unit} · FV {lot.expirationDate} · {days === 0 ? 'vence hoy' : `${days} días`}</strong></li>)}</ol>}</article>
        <article className="analysis-ranking"><h3>Pendientes de lote y vencimiento · {pendingLotAssignments.length}</h3>{pendingLotAssignments.length === 0 ? <p>Todos los ingresos están correctamente identificados.</p> : <ol>{pendingLotAssignments.slice(0, 10).map((entry) => <li key={entry.id}><span>{entry.code} · {entry.productName}</span><strong>{entry.assignmentStatus === 'partial' ? `${formatQuantity(entry.pendingQuantity)} de ${formatQuantity(entry.quantity)} ${entry.unit} pendientes` : `${formatQuantity(entry.quantity)} ${entry.unit} · ${entry.assignmentStatus === 'invalid' ? 'Revisar datos' : 'Sin asignar'}`}</strong></li>)}</ol>}</article>
      </section>

      <section className="analysis-table-panel">
        <header><div><p className="eyebrow">Detalle trazable</p><h2>Análisis por producto</h2></div><label>Ordenar<select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="days">Más días sin movimiento</option><option value="never-moved">Productos sin movimientos</option><option value="turnover">Mayor rotación</option><option value="product">Producto</option></select></label></header>
        <div className="table-wrap">
          <ColumnFilterTable pageSize={100} key={`${moduleFilter}-${hasExpirationData}`} className={`analysis-table${hasExpirationData ? ' has-expiration' : ''}`}>
            <thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Inicial</th><th>Entradas</th><th>Salidas</th><th>Final</th><th>Disponible total</th><th>Promedio</th><th>Rotación</th><th>Última salida</th><th>Días sin movimiento</th>{hasExpirationData && <th>Vencimiento</th>}<th>Estado</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product.id} className={row.quality !== 'exact' ? 'analysis-row-review' : ''} title={row.classification.reasons.join(' ')}>
                  <td>{row.product.code || 'Sin código'}</td><td data-filter-value={row.product.name}><button type="button" className="analysis-product-link" onClick={() => setSelectedProductId(row.product.id)}>{row.product.name}</button><small>{row.product.module} · {row.product.unit}</small></td><td>{row.product.category}</td>
                  <td className="numeric">{formatQuantity(row.openingInventory)}</td><td className="numeric">{formatQuantity(row.entries)}</td><td className="numeric">{formatQuantity(row.exits)}</td><td className="numeric">{formatQuantity(row.closingInventory)}</td><td className="numeric analysis-current-stock">{formatQuantity(row.product.currentStock ?? null)}</td><td className="numeric">{formatQuantity(row.averageInventory)}</td><td className="numeric">{formatTurnover(row.turnover)}</td>
                  <td>{row.lastExitDate ?? 'Sin salidas registradas'}</td><td className="numeric">{row.daysWithoutMovement ?? 'N/A'}</td>{hasExpirationData && <td>{row.product.expirationDate || 'N/A'}</td>}<td><span className={`analysis-status status-${row.classification.status}`}>{row.classification.label}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={hasExpirationData ? 14 : 13} className="empty-cell">No hay productos que coincidan con los filtros.</td></tr>}
            </tbody>
          </ColumnFilterTable>
        </div>
      </section>

      {selectedRow && (
        <div className="analysis-detail-backdrop" role="presentation" onClick={() => setSelectedProductId(null)}>
          <section className="analysis-detail-modal" role="dialog" aria-modal="true" aria-label={`Detalle de ${selectedRow.product.name}`} onClick={(event) => event.stopPropagation()}>
            <header className="analysis-detail-header">
              <div><p className="eyebrow">Detalle del producto</p><h2>{selectedRow.product.code} · {selectedRow.product.name}</h2><span>{selectedRow.product.module} · {selectedRow.product.category} · {selectedRow.product.unit}</span></div>
              <button type="button" aria-label="Cerrar detalle" onClick={() => setSelectedProductId(null)}><X size={19} /></button>
            </header>

            <div className="analysis-detail-body">
              <section className="analysis-detail-kpis">
                <article><span>Stock actual</span><strong>{formatQuantity(selectedRow.product.currentStock ?? null)}</strong></article>
                <article><span>Inicial del período</span><strong>{formatQuantity(selectedRow.openingInventory)}</strong></article>
                <article><span>Entradas</span><strong>{formatQuantity(selectedRow.entries)}</strong></article>
                <article><span>Salidas</span><strong>{formatQuantity(selectedRow.exits)}</strong></article>
                <article><span>Final del período</span><strong>{formatQuantity(selectedRow.closingInventory)}</strong></article>
                <article><span>Rotación</span><strong>{formatTurnover(selectedRow.turnover)}</strong></article>
                <article><span>Última entrada</span><strong>{selectedRow.lastEntryDate ?? 'Sin entradas'}</strong></article>
                <article><span>Última salida</span><strong>{selectedRow.lastExitDate ?? 'Sin salidas'}</strong></article>
              </section>

              <section className="analysis-detail-summary">
                <div><TrendingUp size={20} /><div><strong>{selectedRow.classification.label}</strong>{selectedRow.classification.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div></div>
                {selectedRow.issues.length > 0 && <div className="analysis-detail-issues"><AlertTriangle size={18} /><div><strong>Calidad del histórico: {selectedRow.quality}</strong>{selectedRow.issues.map((issue) => <p key={`${issue.code}-${issue.movementId ?? ''}`}>{issue.message}{issue.movementId ? ` (${issue.movementId})` : ''}</p>)}</div></div>}
              </section>

              <section className="analysis-product-insights">
                <header><p className="eyebrow">Análisis automático</p><h3>Datos, tendencias y alertas</h3></header>
                <div>{selectedInsights.map((insight) => <article className={`insight-${insight.kind}`} key={`${insight.kind}-${insight.title}`}><span>{insight.kind === 'data' ? 'Dato' : insight.kind === 'trend' ? 'Tendencia' : 'Alerta'}</span><strong>{insight.title}</strong><p>{insight.message}</p></article>)}</div>
              </section>

              <section className="analysis-history-section">
                <header><div><p className="eyebrow">Evolución histórica</p><h3>Últimos 12 meses disponibles</h3></div></header>
                <div className="analysis-mini-chart" aria-label="Evolución mensual de salidas, rotación y días sin movimiento">
                  {selectedHistory.map((entry) => (
                    <div className="analysis-mini-period" key={entry.period.from}>
                      <div className="analysis-mini-bars">
                        <span className="bar-exits" style={{ height: `${Math.max(3, (entry.exits / historyMax) * 100)}%` }} title={`Salidas: ${formatQuantity(entry.exits)}`} />
                        <span className="bar-turnover" style={{ height: `${Math.max(3, (((entry.turnover ?? 0) * 10) / historyMax) * 100)}%` }} title={`Rotación: ${formatTurnover(entry.turnover)}`} />
                        <span className="bar-days" style={{ height: `${Math.max(3, (((entry.daysWithoutMovement ?? 0)) / historyMax) * 100)}%` }} title={`Días: ${entry.daysWithoutMovement ?? 'N/A'}`} />
                      </div>
                      <small>{entry.label}</small>
                    </div>
                  ))}
                </div>
                <div className="analysis-chart-legend"><span className="legend-exits">Salidas</span><span className="legend-turnover">Rotación × 10</span><span className="legend-days">Días sin movimiento</span></div>
                <div className="table-wrap"><ColumnFilterTable className="analysis-history-table"><thead><tr><th>Mes</th><th>Inicial</th><th>Entradas</th><th>Salidas</th><th>Final</th><th>Rotación</th><th>Días sin movimiento</th></tr></thead><tbody>{selectedHistory.map((entry) => <tr key={entry.period.from}><td>{entry.label}</td><td>{formatQuantity(entry.openingInventory)}</td><td>{formatQuantity(entry.entries)}</td><td>{formatQuantity(entry.exits)}</td><td>{formatQuantity(entry.closingInventory)}</td><td>{formatTurnover(entry.turnover)}</td><td>{entry.daysWithoutMovement ?? 'N/A'}</td></tr>)}</tbody></ColumnFilterTable></div>
              </section>

              <section className="analysis-evidence-section">
                <header><p className="eyebrow">Trazabilidad</p><h3>Movimientos usados en el cálculo</h3><small>Incluye las anclas históricas anteriores necesarias para reconstruir el saldo inicial.</small></header>
                {selectedEvidenceMovements.length === 0 ? <p>No hay movimientos vinculados que puedan mostrarse para este cálculo.</p> : <div className="table-wrap"><ColumnFilterTable><thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Saldo anterior</th><th>Saldo nuevo</th><th>ID</th></tr></thead><tbody>{selectedEvidenceMovements.map((movement) => <tr key={movement.id}><td>{movement.occurredAt}</td><td>{movement.type}</td><td>{formatQuantity(movement.quantity)}</td><td>{formatQuantity(movement.stockBefore ?? null)}</td><td>{formatQuantity(movement.stockAfter ?? null)}</td><td><code>{movement.id}</code></td></tr>)}</tbody></ColumnFilterTable></div>}
              </section>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
