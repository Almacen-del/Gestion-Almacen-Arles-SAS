import ColumnFilterTable from './ColumnFilterTable';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleDollarSign,
  PackageCheck,
  Pencil,
  Save,
  Search,
  X,
} from 'lucide-react';
import { moduleAccent } from '../theme';
import { filterCurrentValuationRows, summarizeCurrentValuation } from '../valuation/currentValuation';
import {
  currentValuationPeriod,
  DuplicateMonthlyCloseError,
  EarlyMonthlyCloseConfirmationError,
  formatValuationPeriod,
  loadMonthlyValuationSummaryPage,
  loadMonthlyValuationItems,
  mergeMonthlyValuationSummaryPages,
  MonthlyCloseInProgressError,
  MonthlyCloseRetryNotAllowedError,
  MonthlyCloseVerificationError,
  saveMonthlyValuationClose,
  subscribeMonthlyValuationPeriod,
} from '../valuation/monthlyValuation';
import type {
  CurrentValuationRow,
  MonthlyValuationItem,
  MonthlyValuationSummary,
  ValuationFilter,
} from '../valuation/models';
import type { EntryStockMovement, EntryValuationRecord } from '../valuation/entryValuation';
import type { EstimatedExitExpense } from '../valuation/exitExpense';
import {
  EMPTY_FIRESTORE_SOURCE_STATE,
  stateFromSnapshot,
  type FirestoreSourceStates,
} from '../valuation/firestoreSync';
import {
  evaluateMonthlyCloseEligibility,
  formatBogotaDateTime,
  isEarlyCloseConfirmationValid,
} from '../valuation/monthlyCloseSafety';
import { isInventoryValuationModuleIncluded } from '../valuation/inventoryValuationScope';
import { shouldShowCurrentValueModuleCard } from './currentValueModuleCards';
import PendingEntryValuations from './PendingEntryValuations';
import MonthlyActivityPanel from './MonthlyActivityPanel';
import type { MonthlyActivitySource } from '../valuation/monthlyActivity';

type ValuationTab = 'current' | 'entries' | 'history';
type MonthlySaveState = 'idle' | 'saving' | 'saved' | 'error';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
}

function formatPercentage(value: number) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(value);
}

function monthShortLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat('es-CO', { month: 'short' })
    .format(new Date(year, month - 1, 1))
    .replace('.', '');
}

function previousPeriodFor(period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return '';
  const previous = new Date(year, month - 2, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
}

function EvolutionChart({ summaries }: { summaries: MonthlyValuationSummary[] }) {
  const ordered = [...summaries].slice(0, 12).reverse();
  if (ordered.length === 0) return <p className="valuation-chart-empty">Todavía no hay meses guardados para graficar.</p>;

  const width = 720;
  const height = 240;
  const left = 58;
  const right = 18;
  const top = 24;
  const bottom = 46;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maximum = Math.max(...ordered.map((entry) => entry.totalValue), 1);
  const points = ordered.map((entry, index) => {
    const x = ordered.length === 1 ? left + chartWidth / 2 : left + (index / (ordered.length - 1)) * chartWidth;
    const y = top + chartHeight - (entry.totalValue / maximum) * chartHeight;
    return { entry, x, y };
  });

  return (
    <div className="valuation-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolución del valor total mensual">
        {[0, 0.5, 1].map((ratio) => {
          const y = top + chartHeight * ratio;
          const value = maximum * (1 - ratio);
          return (
            <g key={ratio}>
              <line className="chart-grid-line" x1={left} x2={width - right} y1={y} y2={y} />
              <text className="chart-axis-label" x={left - 8} y={y + 4} textAnchor="end">{formatCompactCurrency(value)}</text>
            </g>
          );
        })}
        {points.length > 1 && (
          <polyline
            className="chart-value-line"
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          />
        )}
        {points.map(({ entry, x, y }) => (
          <g key={entry.period}>
            <circle className="chart-value-point" cx={x} cy={y} r="5">
              <title>{formatValuationPeriod(entry.period)}: {formatCurrency(entry.totalValue)}</title>
            </circle>
            <text className="chart-month-label" x={x} y={height - 17} textAnchor="middle">{monthShortLabel(entry.period)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function ModuleValueBars({ moduleTotals }: { moduleTotals: Record<string, number> }) {
  const entries = Object.entries(moduleTotals)
    .sort((left, right) => right[1] - left[1]);
  const maximum = Math.max(...entries.map((entry) => entry[1]), 1);

  if (entries.length === 0) return <p className="valuation-chart-empty">Este corte no tiene totales por módulo.</p>;

  return (
    <div className="valuation-module-bars">
      {entries.map(([moduleName, value]) => (
        <div className="valuation-module-bar" key={moduleName}>
          <div className="valuation-module-bar-heading">
            <span>{moduleName}</span>
            <strong>{formatCurrency(value)}</strong>
          </div>
          <div className="valuation-module-bar-track">
            <span
              style={{
                '--bar-width': `${Math.max((value / maximum) * 100, value > 0 ? 2 : 0)}%`,
                '--bar-accent': moduleAccent(moduleName),
              } as CSSProperties}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthlyCloseConfirmation({
  period,
  productCount,
  totalValue,
  cutoffAt,
  requiresTypedConfirmation,
  confirmationText,
  onCancel,
  onConfirm,
}: {
  period: string;
  productCount: number;
  totalValue: number;
  cutoffAt: Date;
  requiresTypedConfirmation: boolean;
  confirmationText: string;
  onCancel: () => void;
  onConfirm: (earlyConfirmation: string) => void;
}) {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const confirmationValid = !requiresTypedConfirmation
    || isEarlyCloseConfirmationValid(typedConfirmation, confirmationText);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="entries-modal valuation-close-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar corte mensual de valoración"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="evidence-header">
          <div>
            <p className="eyebrow">Cierre mensual</p>
            <h2>Guardar corte de {formatValuationPeriod(period)}</h2>
          </div>
          <button className="icon-button" type="button" title="Cerrar" onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="valuation-close-confirmation">
          <AlertTriangle size={28} />
          <p>Se guardará una fotografía permanente de <strong>{formatNumber(productCount)} productos</strong> por un total de <strong>{formatCurrency(totalValue)}</strong>.</p>
          <p className="valuation-close-time"><strong>Fecha y hora previstas:</strong> {formatBogotaDateTime(cutoffAt)}</p>
          <small>Después de completarse no se podrá crear otro corte para el mismo periodo.</small>
          {requiresTypedConfirmation && (
            <label className="valuation-close-typed-confirmation">
              <span>El mes todavía no ha terminado. Escribe <strong>{confirmationText}</strong> para continuar:</span>
              <input
                value={typedConfirmation}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={confirmationText}
              />
            </label>
          )}
        </div>
        <footer className="valuation-modal-actions valuation-close-actions">
          <button type="button" onClick={onCancel}>Cancelar</button>
          <button className="tool-button" type="button" disabled={!confirmationValid} onClick={() => onConfirm(typedConfirmation)}><Save size={16} /> Confirmar corte</button>
        </footer>
      </section>
    </div>
  );
}

function CurrentValuationView({
  monthlyActivitySources,
  rows,
  moduleOptions,
  online,
  loading,
  user,
  firestoreSources,
  pendingEntryCount,
  inconsistentEntryCount,
  estimatedExitExpense,
  exitHistoryComplete,
  exitHistoryLoading,
  onEdit,
}: {
  monthlyActivitySources: readonly MonthlyActivitySource[];
  rows: CurrentValuationRow[];
  moduleOptions: string[];
  online: boolean;
  loading: boolean;
  user: User;
  firestoreSources: FirestoreSourceStates;
  pendingEntryCount: number;
  inconsistentEntryCount: number;
  estimatedExitExpense: EstimatedExitExpense;
  exitHistoryComplete: boolean;
  exitHistoryLoading: boolean;
  onEdit: (valuationId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [valueFilter, setValueFilter] = useState<ValuationFilter>('all');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationCutoffAt, setConfirmationCutoffAt] = useState<Date | null>(null);
  const [saveState, setSaveState] = useState<MonthlySaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [saveProgress, setSaveProgress] = useState({ completed: 0, total: 1 });
  const [existingClose, setExistingClose] = useState<MonthlyValuationSummary | null>(null);
  const [closesSource, setClosesSource] = useState({ ...EMPTY_FIRESTORE_SOURCE_STATE });
  const period = currentValuationPeriod();
  const summary = useMemo(() => summarizeCurrentValuation(rows, moduleOptions), [moduleOptions, rows]);
  const filteredRows = useMemo(
    () => filterCurrentValuationRows(rows, search, moduleFilter, valueFilter),
    [moduleFilter, rows, search, valueFilter],
  );
  const eligibility = evaluateMonthlyCloseEligibility({
    movementHistoryComplete: exitHistoryComplete,
    period,
    now: new Date(),
    online,
    sources: firestoreSources,
    closesSource,
    rows,
    pendingEntryCount,
    inconsistentEntryCount,
    existingCloseStatus: existingClose?.status ?? null,
    existingCloseCreatorUid: existingClose?.createdByUid ?? '',
    userUid: user.uid,
  });

  useEffect(() => subscribeMonthlyValuationPeriod(
    period,
    setExistingClose,
    (error) => {
      console.error('No se pudieron consultar los cierres mensuales:', error);
      setClosesSource((current) => ({
        ...current,
        error: 'No se pudieron consultar los cierres mensuales.',
      }));
    },
    (metadata) => setClosesSource(stateFromSnapshot(metadata)),
  ), [period]);

  async function confirmMonthlyClose(earlyConfirmation: string) {
    const latestEligibility = evaluateMonthlyCloseEligibility({
      movementHistoryComplete: exitHistoryComplete,
      period,
      now: new Date(),
      online,
      sources: firestoreSources,
      closesSource,
      rows,
      pendingEntryCount,
      inconsistentEntryCount,
      existingCloseStatus: existingClose?.status ?? null,
      existingCloseCreatorUid: existingClose?.createdByUid ?? '',
      userUid: user.uid,
    });
    if (!latestEligibility.eligible) {
      setConfirmationOpen(false);
      setSaveState('error');
      setSaveMessage(latestEligibility.reasons[0] ?? 'El cierre ya no es elegible.');
      return;
    }
    setConfirmationOpen(false);
    setSaveState('saving');
    setSaveMessage('Preparando corte mensual...');
    setSaveProgress({ completed: 0, total: 1 });

    try {
      const result = await saveMonthlyValuationClose({
        movements: monthlyActivitySources,
        historyComplete: exitHistoryComplete,
        period,
        rows,
        moduleOptions,
        user,
        earlyConfirmation,
        onProgress: (completed, total) => {
          setSaveProgress({ completed, total });
          setSaveMessage(completed === total ? 'Corte mensual guardado.' : `Guardando paso ${completed} de ${total}...`);
        },
      });
      setSaveState('saved');
      setSaveMessage(result.completedAt
        ? `Corte completado exactamente el ${formatBogotaDateTime(result.completedAt)}.`
        : `Corte de ${formatValuationPeriod(period)} guardado correctamente.`);
    } catch (error) {
      console.error('No se pudo guardar el corte mensual:', error);
      setSaveState('error');
      if (error instanceof DuplicateMonthlyCloseError) {
        setSaveMessage('Ya existe un corte completo para este mes. No se creó un duplicado.');
      } else if (error instanceof MonthlyCloseInProgressError) {
        setSaveMessage('Ya hay un guardado en curso para este mes. Espera a que termine.');
      } else if (error instanceof MonthlyCloseRetryNotAllowedError) {
        setSaveMessage('Solo el creador puede reintentar este cierre fallido.');
      } else if (error instanceof MonthlyCloseVerificationError) {
        setSaveMessage('La verificación final no coincidió. El corte quedó en estado error y puede reintentarse.');
      } else if (error instanceof EarlyMonthlyCloseConfirmationError) {
        setSaveMessage(error.message);
      } else {
        setSaveMessage('No se pudo completar el corte. Verifica la conexión y los permisos de Firestore.');
      }
    }
  }

  const progressPercent = Math.round((saveProgress.completed / Math.max(saveProgress.total, 1)) * 100);

  return (
    <section className="valuation-current-view" aria-label="Valor actual del inventario">
      <div className="valuation-current-toolbar">
        <label className="search-box">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar módulo, código, producto o referencia" />
        </label>
        <label className="status-sort valuation-filter">
          <span>Módulo:</span>
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
            <option value="all">Todos</option>
            {moduleOptions.map((moduleName) => <option key={moduleName} value={moduleName}>{moduleName}</option>)}
          </select>
        </label>
        <label className="status-sort valuation-filter">
          <span>Valor:</span>
          <select value={valueFilter} onChange={(event) => setValueFilter(event.target.value as ValuationFilter)}>
            <option value="all">Todos</option>
            <option value="valued">Con valor</option>
            <option value="unvalued">Sin valor</option>
          </select>
        </label>
        <button
          className="tool-button valuation-close-button"
          type="button"
          disabled={!eligibility.eligible || saveState === 'saving'}
          onClick={() => {
            setConfirmationCutoffAt(new Date());
            setConfirmationOpen(true);
          }}
          title={eligibility.reasons[0] ?? 'Guardar fotografía mensual del inventario'}
        >
          {existingClose?.status === 'completo' ? <Check size={17} /> : <Save size={17} />}
          {existingClose?.status === 'completo'
            ? 'Corte del mes guardado'
            : existingClose?.status === 'error'
              ? 'Reintentar corte del mes'
              : existingClose?.status === 'guardando'
                ? 'Corte en proceso'
                : 'Guardar corte del mes'}
        </button>
      </div>

      {!eligibility.eligible && saveState !== 'saving' && (
        <div className="valuation-close-blockers" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>El cierre mensual está bloqueado</strong>
            <ul>{eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        </div>
      )}

      {(saveState === 'saving' || saveMessage) && (
        <div className={`valuation-save-progress ${saveState}`} role="status">
          <div><span>{saveMessage}</span><strong>{saveState === 'saving' ? `${progressPercent}%` : ''}</strong></div>
          {saveState === 'saving' && <progress max="100" value={progressPercent}>{progressPercent}%</progress>}
        </div>
      )}

      <section className="valuation-summary-grid">
        <article className="valuation-summary-card total">
          <CircleDollarSign size={24} />
          <div>
            <span>Valor total de todo el inventario</span>
            <strong>{formatCurrency(summary.inventoryGrandTotal)}</strong>
            <small>{formatNumber(summary.productCount)} productos registrados</small>
          </div>
        </article>
        <article className="valuation-summary-card valued">
          <PackageCheck size={24} />
          <div>
            <span>Productos con valor</span>
            <strong>{formatNumber(summary.valuedProductCount)}</strong>
            <small>{formatPercentage(summary.valuedPercentage)}% del inventario</small>
          </div>
        </article>
        <article className="valuation-summary-card unvalued">
          <AlertTriangle size={24} />
          <div>
            <span>Productos sin valor</span>
            <strong>{formatNumber(summary.unvaluedProductCount)}</strong>
            <small>Pendientes de valoración</small>
          </div>
        </article>
      </section>

      <section className="valuation-module-section" aria-labelledby="valuation-module-totals-title">
        <div className="valuation-section-heading">
          <div>
            <p className="eyebrow">Totales separados por módulo</p>
            <h2 id="valuation-module-totals-title">Distribución del valor actual</h2>
          </div>
          {moduleFilter !== 'all' && (
            <button type="button" onClick={() => setModuleFilter('all')}><X size={14} /> Ver todos</button>
          )}
        </div>
        <div className="valuation-module-grid">
          {summary.moduleTotals
            .filter((entry) => shouldShowCurrentValueModuleCard(entry.moduleName))
            .map((entry) => (
              <button
                type="button"
                key={entry.moduleName}
                className={moduleFilter === entry.moduleName ? 'active' : ''}
                onClick={() => setModuleFilter(entry.moduleName)}
                style={{ '--card-accent': moduleAccent(entry.moduleName) } as CSSProperties}
              >
                <span>{entry.moduleName}</span>
                <strong>{formatCurrency(entry.total)}</strong>
                <small>{entry.valuedCount} con valor de {entry.productCount}</small>
              </button>
            ))}
          <article className="valuation-exit-expense-card" title="Estimación calculada con el valor unitario promedio actual de cada producto; no reemplaza un costo histórico por salida.">
            <span>Gasto total estimado de salidas</span>
            <strong>{exitHistoryComplete ? formatCurrency(estimatedExitExpense.estimatedTotal) : 'Calculando…'}</strong>
            <small>{exitHistoryComplete
              ? `${estimatedExitExpense.valuedExitCount} de ${estimatedExitExpense.exitCount} salidas con precio${estimatedExitExpense.unvaluedExitCount + estimatedExitExpense.unresolvedExitCount > 0 ? ` · ${estimatedExitExpense.unvaluedExitCount + estimatedExitExpense.unresolvedExitCount} sin precio, no sumadas` : ''}`
              : exitHistoryLoading ? 'Cargando el historial completo…' : 'Esperando el historial completo…'}</small>
            {exitHistoryComplete && estimatedExitExpense.missingValuations.length > 0 && (
              <details className="valuation-missing-exit-prices">
                <summary>Ver precios faltantes</summary>
                <ul>{estimatedExitExpense.missingValuations.map((entry) => <li key={entry.productId}><span>{entry.code} · {entry.product}</span><small>{entry.moduleName} · {entry.exitCount} {entry.exitCount === 1 ? 'salida' : 'salidas'}</small></li>)}</ul>
              </details>
            )}
          </article>
        </div>
      </section>

      <article className="panel valuation-general-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Inventario consolidado</p>
            <h2>Tabla general</h2>
            <small>{formatNumber(filteredRows.length)} productos visibles</small>
          </div>
          <CircleDollarSign size={20} />
        </div>
        <div className="table-wrap valuation-table-wrap">
          <ColumnFilterTable className="inventory-table valuation-general-table">
            <thead>
              <tr>
                <th>Módulo</th>
                <th className="col-code">Código</th>
                <th className="col-desc">Producto</th>
                <th className="col-ref">Referencia</th>
                <th className="numeric">Cantidad</th>
                <th className="col-unit">Unidad</th>
                <th className="numeric col-valuation-unit">Valor unitario</th>
                <th className="numeric col-valuation-total">Valor total</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.valuationId}>
                  <td data-label="Módulo"><span className="valuation-module-badge" style={{ '--badge-accent': moduleAccent(row.moduleName) } as CSSProperties}>{row.moduleName}</span></td>
                  <td className="code col-code" data-label="Código">{row.code}</td>
                  <td className="col-desc" data-label="Producto">{row.product}</td>
                  <td className="col-ref" data-label="Referencia">{row.reference || 'N/A'}</td>
                  <td className="numeric valuation-quantity" data-label="Cantidad">
                    <strong>{formatNumber(row.quantity)}</strong>
                    {row.includesOccupied && <small>Incluye ocupados</small>}
                  </td>
                  <td className="col-unit" data-label="Unidad">{row.unit}</td>
                  <td className="numeric valuation-unit-cell" data-label="Valor unitario">
                    <button
                      type="button"
                      className={`valuation-edit-button ${row.unitValue > 0 ? 'valued' : 'unvalued'}`}
                      onClick={() => onEdit(row.valuationId)}
                      disabled={!online}
                      title={online ? `Editar valor unitario de ${row.product}` : 'Conéctate para editar el valor unitario'}
                    >
                      <span>{formatCurrency(row.unitValue)}</span>
                      <Pencil size={14} />
                    </button>
                  </td>
                  <td className="numeric valuation-total" data-label="Valor total">{formatCurrency(row.totalValue)}</td>
                </tr>
              ))}
              {!loading && filteredRows.length === 0 && (
                <tr><td colSpan={8} className="empty-cell"><div className="empty-state"><Search size={28} /><strong>Sin productos para estos filtros</strong><span>Ajusta el módulo, el estado de valoración o el buscador.</span></div></td></tr>
              )}
              {loading && (
                <tr><td colSpan={8} className="empty-cell"><div className="loading-state"><span className="loading-dot" /><span>Cargando valoración desde Firestore...</span></div></td></tr>
              )}
            </tbody>
          </ColumnFilterTable>
        </div>
      </article>

      {confirmationOpen && confirmationCutoffAt && (
        <MonthlyCloseConfirmation
          period={period}
          productCount={summary.productCount}
          totalValue={summary.inventoryGrandTotal}
          cutoffAt={confirmationCutoffAt}
          requiresTypedConfirmation={eligibility.requiresEarlyConfirmation}
          confirmationText={eligibility.confirmationText}
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={(earlyConfirmation) => { void confirmMonthlyClose(earlyConfirmation); }}
        />
      )}
    </section>
  );
}

function HistoricalValuationView({ sources, historyReady }: { sources: readonly MonthlyActivitySource[]; historyReady: boolean }) {
  const [view, setView] = useState<'inventory' | 'movements' | 'expense'>('inventory');
  const [itemsPeriod, setItemsPeriod] = useState('');
  const [summaries, setSummaries] = useState<MonthlyValuationSummary[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [items, setItems] = useState<MonthlyValuationItem[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [loadingMoreSummaries, setLoadingMoreSummaries] = useState(false);
  const [hasMoreSummaries, setHasMoreSummaries] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const summaryCursorRef = useRef<string | null>(null);
  const loadingSummaryPageRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoadingSummaries(true);
    void loadMonthlyValuationSummaryPage()
      .then((page) => {
        if (!active) return;
        setSummaries(page.summaries);
        setSelectedPeriod(page.summaries[0]?.period ?? '');
        summaryCursorRef.current = page.cursor;
        setHasMoreSummaries(page.hasMore);
        setHistoryError('');
      })
      .catch((error) => {
        console.error('No se pudieron cargar los cierres mensuales:', error);
        if (active) setHistoryError('No se pudieron consultar los meses guardados. Verifica los permisos de Firestore.');
      })
      .finally(() => {
        if (active) setLoadingSummaries(false);
      });
    return () => { active = false; };
  }, []);

  async function loadMoreSummaries() {
    if (loadingSummaryPageRef.current || !hasMoreSummaries) return;
    loadingSummaryPageRef.current = true;
    setLoadingMoreSummaries(true);
    setHistoryError('');
    try {
      const page = await loadMonthlyValuationSummaryPage(summaryCursorRef.current);
      setSummaries((current) => mergeMonthlyValuationSummaryPages(current, page.summaries));
      summaryCursorRef.current = page.cursor;
      setHasMoreSummaries(page.hasMore);
    } catch (error) {
      console.error('No se pudo cargar otra página de cierres mensuales:', error);
      setHistoryError('No se pudieron cargar meses anteriores. Intenta nuevamente.');
    } finally {
      loadingSummaryPageRef.current = false;
      setLoadingMoreSummaries(false);
    }
  }

  useEffect(() => {
    if (!selectedPeriod) {
      setItems([]);
      return;
    }
    let active = true;
    setLoadingItems(true);
    setHistoryError('');
    void loadMonthlyValuationItems(selectedPeriod)
      .then((nextItems) => {
        if (active) { setItems(nextItems); setItemsPeriod(selectedPeriod); }
      })
      .catch((error) => {
        console.error('No se pudo cargar el detalle del corte mensual:', error);
        if (active) setHistoryError('No se pudo cargar el detalle del mes seleccionado.');
      })
      .finally(() => {
        if (active) setLoadingItems(false);
      });
    return () => { active = false; };
  }, [selectedPeriod]);

  const selectedSummary = summaries.find((entry) => entry.period === selectedPeriod) ?? null;
  const previousSummary = selectedSummary
    ? summaries.find((entry) => entry.period === previousPeriodFor(selectedSummary.period)) ?? null
    : null;
  const variationAmount = selectedSummary && previousSummary
    ? selectedSummary.totalValue - previousSummary.totalValue
    : null;
  const variationPercent = variationAmount !== null && previousSummary && previousSummary.totalValue !== 0
    ? (variationAmount / previousSummary.totalValue) * 100
    : null;
  const topProducts = useMemo(
    () => [...items].filter((item) => item.totalValue > 0).sort((left, right) => right.totalValue - left.totalValue).slice(0, 10),
    [items],
  );

  if (loadingSummaries) {
    return <div className="loading-state valuation-history-loading"><span className="loading-dot" /><span>Cargando histórico mensual...</span></div>;
  }

  return (
    <section className="valuation-history-view" aria-label="Histórico mensual de valoración">
      <div className="valuation-history-toolbar">
        <div>
          <p className="eyebrow">Cierres disponibles</p>
          <h2>Consulta un corte mensual guardado</h2>
        </div>
        <label className="status-sort valuation-month-selector">
          <CalendarDays size={17} />
          <span>Mes:</span>
          <select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)} disabled={summaries.length === 0}>
            {summaries.length === 0 && <option value="">Sin meses guardados</option>}
            {summaries.map((entry) => <option key={entry.period} value={entry.period}>{formatValuationPeriod(entry.period)}</option>)}
          </select>
        </label>
      </div>

      {hasMoreSummaries && (
        <div className="history-pagination monthly-history-pagination">
          <div>
            <strong>Histórico cargado parcialmente</strong>
            <span>{summaries.length} meses completos cargados. Hay cierres anteriores disponibles.</span>
          </div>
          <button type="button" disabled={loadingMoreSummaries} onClick={() => { void loadMoreSummaries(); }}>
            {loadingMoreSummaries ? 'Cargando...' : 'Cargar más meses'}
          </button>
        </div>
      )}

      {historyError && <div className="alert-line"><AlertTriangle size={18} />{historyError}</div>}

      {selectedSummary && <div className="valuation-tabs monthly-activity-view-tabs" role="tablist" aria-label="Contenido del histórico mensual">
        {([['inventory', 'Valor del inventario'], ['movements', 'Entradas y salidas'], ['expense', 'Gasto mensual']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}
      </div>}

      {!selectedSummary ? (
        <article className="panel valuation-history-empty">
          <CalendarDays size={34} />
          <h2>No hay cortes mensuales guardados</h2>
          <p>Usa “Guardar corte del mes” en la pestaña Valor actual para crear el primer histórico.</p>
        </article>
      ) : view !== 'inventory' ? (
        <MonthlyActivityPanel key={selectedSummary.period} view={view} summary={selectedSummary} items={items}
          sources={sources} historyReady={historyReady} itemsReady={itemsPeriod === selectedPeriod && !loadingItems} />
      ) : (
        <>
          <section className="valuation-history-summary-grid">
            <article className="valuation-summary-card total">
              <CircleDollarSign size={24} />
              <div>
                <span>Valor total del mes</span>
                <strong>{formatCurrency(selectedSummary.totalValue)}</strong>
                <small>{formatValuationPeriod(selectedSummary.period)}</small>
                {selectedSummary.createdAt && <small>Corte exacto: {formatBogotaDateTime(selectedSummary.createdAt)}</small>}
              </div>
            </article>
            <article className={`valuation-summary-card variation ${variationAmount !== null && variationAmount < 0 ? 'negative' : ''}`}>
              <CalendarDays size={24} />
              <div>
                <span>Variación contra el mes anterior</span>
                <strong>{variationAmount === null ? 'Sin comparación' : `${variationAmount >= 0 ? '+' : ''}${formatCurrency(variationAmount)}`}</strong>
                <small>{variationPercent === null ? 'No hay base mensual anterior' : `${variationPercent >= 0 ? '+' : ''}${formatPercentage(variationPercent)}% vs. ${formatValuationPeriod(previousSummary!.period)}`}</small>
              </div>
            </article>
            <article className="valuation-summary-card valued">
              <PackageCheck size={24} />
              <div><span>Productos y cobertura</span><strong>{formatNumber(selectedSummary.productCount)}</strong><small>{formatPercentage(selectedSummary.valuedPercentage)}% valorado ({selectedSummary.valuedProductCount} con valor)</small></div>
            </article>
          </section>

          <section className="valuation-history-charts">
            <article className="valuation-history-card valuation-evolution-card">
              <div className="valuation-card-heading"><div><p className="eyebrow">Hasta 12 meses</p><h2>Evolución del valor</h2></div><strong>{formatCurrency(selectedSummary.totalValue)}</strong></div>
              <EvolutionChart summaries={summaries} />
            </article>
            <article className="valuation-history-card">
              <div className="valuation-card-heading"><div><p className="eyebrow">Distribución mensual</p><h2>Valor por módulo</h2></div></div>
              <ModuleValueBars moduleTotals={selectedSummary.moduleTotals} />
            </article>
          </section>

          <article className="valuation-history-card valuation-top-products">
            <div className="valuation-card-heading"><div><p className="eyebrow">Mayor participación</p><h2>Top 10 productos por valor</h2></div></div>
            {topProducts.length === 0 ? <p className="valuation-chart-empty">No hay productos valorados en este corte.</p> : (
              <ol>
                {topProducts.map((item) => (
                  <li key={item.id}>
                    <span className="valuation-top-rank" />
                    <div><strong>{item.product}</strong><small>{item.moduleName} · {item.code} · {item.reference}</small></div>
                    <strong>{formatCurrency(item.totalValue)}</strong>
                  </li>
                ))}
              </ol>
            )}
          </article>

          <article className="panel valuation-general-panel valuation-history-table-panel">
            <div className="panel-header">
              <div><p className="eyebrow">Detalle inalterable del corte</p><h2>Tabla mensual</h2><small>{formatNumber(items.length)} productos guardados</small></div>
              <CalendarDays size={20} />
            </div>
            <div className="table-wrap valuation-table-wrap">
              <ColumnFilterTable key={selectedPeriod} className="inventory-table valuation-general-table valuation-history-table">
                <thead><tr><th>Módulo</th><th className="col-code">Código</th><th className="col-desc">Producto</th><th className="col-ref">Referencia</th><th className="numeric">Cantidad</th><th className="col-unit">Unidad</th><th className="numeric col-valuation-unit">Valor unitario</th><th className="numeric col-valuation-total">Valor total</th></tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Módulo"><span className="valuation-module-badge" style={{ '--badge-accent': moduleAccent(item.moduleName) } as CSSProperties}>{item.moduleName}</span></td>
                      <td className="code col-code" data-label="Código">{item.code}</td>
                      <td className="col-desc" data-label="Producto">{item.product}</td>
                      <td className="col-ref" data-label="Referencia">{item.reference || 'N/A'}</td>
                      <td className="numeric" data-label="Cantidad">{formatNumber(item.quantity)}</td>
                      <td className="col-unit" data-label="Unidad">{item.unit}</td>
                      <td className="numeric" data-label="Valor unitario">{formatCurrency(item.unitValue)}</td>
                      <td className="numeric valuation-total" data-label="Valor total">{formatCurrency(item.totalValue)}</td>
                    </tr>
                  ))}
                  {loadingItems && <tr><td colSpan={8} className="empty-cell"><div className="loading-state"><span className="loading-dot" /><span>Cargando detalle mensual...</span></div></td></tr>}
                  {!loadingItems && items.length === 0 && <tr><td colSpan={8} className="empty-cell">Este corte no contiene productos.</td></tr>}
                </tbody>
              </ColumnFilterTable>
            </div>
          </article>
        </>
      )}
    </section>
  );
}

export default function InventoryValuationModule({
  monthlyActivitySources,
  rows,
  moduleOptions,
  online,
  loading,
  user,
  currentAverages,
  currentValuationIds,
  firestoreSources,
  entryStockMovements,
  entryValuationRecords,
  estimatedExitExpense,
  exitHistoryComplete,
  exitHistoryLoading,
  onEdit,
}: {
  monthlyActivitySources: readonly MonthlyActivitySource[];
  rows: CurrentValuationRow[];
  moduleOptions: string[];
  online: boolean;
  loading: boolean;
  user: User;
  currentAverages: Record<string, number>;
  currentValuationIds: ReadonlySet<string>;
  firestoreSources: FirestoreSourceStates;
  entryStockMovements: EntryStockMovement[];
  entryValuationRecords: Record<string, EntryValuationRecord>;
  estimatedExitExpense: EstimatedExitExpense;
  exitHistoryComplete: boolean;
  exitHistoryLoading: boolean;
  onEdit: (valuationId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ValuationTab>('current');
  const scopedEntryStockMovements = useMemo(
    () => entryStockMovements.filter((entry) => isInventoryValuationModuleIncluded(entry.moduleName)),
    [entryStockMovements],
  );
  const pendingEntryCount = scopedEntryStockMovements.filter((entry) => !entryValuationRecords[entry.id]).length;
  const inconsistentEntryCount = scopedEntryStockMovements.filter((entry) => Boolean(entry.validationIssue)).length;
  const entryLoading = ['entryMovements', 'entryValuations'].some((key) => {
    const state = firestoreSources[key as 'entryMovements' | 'entryValuations'];
    return !state.received && !state.error;
  });
  const entryLoadError = [
    firestoreSources.entryMovements.error,
    firestoreSources.entryValuations.error,
  ].filter(Boolean).join(' ');

  return (
    <section className="valuation-dashboard" aria-label="Valoración del inventario">
      <div className="valuation-tabs" role="tablist" aria-label="Vistas de valoración">
        <button type="button" role="tab" aria-selected={activeTab === 'current'} className={activeTab === 'current' ? 'active' : ''} onClick={() => setActiveTab('current')}>Valor actual</button>
        <button type="button" role="tab" aria-selected={activeTab === 'entries'} className={activeTab === 'entries' ? 'active' : ''} onClick={() => setActiveTab('entries')}>Entradas por valorar</button>
        <button type="button" role="tab" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>Histórico mensual</button>
      </div>
      {activeTab === 'current' ? (
        <CurrentValuationView
          monthlyActivitySources={monthlyActivitySources}
          rows={rows}
          moduleOptions={moduleOptions}
          online={online}
          loading={loading}
          user={user}
          firestoreSources={firestoreSources}
          pendingEntryCount={pendingEntryCount}
          inconsistentEntryCount={inconsistentEntryCount}
          estimatedExitExpense={estimatedExitExpense}
          exitHistoryComplete={exitHistoryComplete}
          exitHistoryLoading={exitHistoryLoading}
          onEdit={onEdit}
        />
      ) : activeTab === 'entries' ? (
        <PendingEntryValuations
          online={online}
          user={user}
          currentAverages={currentAverages}
          currentValuationIds={currentValuationIds}
          entries={scopedEntryStockMovements}
          records={entryValuationRecords}
          loading={entryLoading}
          loadError={entryLoadError}
        />
      ) : (
        <HistoricalValuationView sources={monthlyActivitySources} historyReady={exitHistoryComplete} />
      )}
    </section>
  );
}
