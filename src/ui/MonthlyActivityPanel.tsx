import ColumnFilterTable from './ColumnFilterTable';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CircleDollarSign } from 'lucide-react';
import type { MonthlyValuationItem, MonthlyValuationSummary } from '../valuation/models';
import {
  buildMonthlyActivity, formatMonthlyActivityDate, groupMonthlyExpenses, isPersonnelExpense, summarizeMonthlyActivity,
  type ExpenseGrouping, type MonthlyActivityRow, type MonthlyActivitySnapshot, type MonthlyActivitySource,
} from '../valuation/monthlyActivity';
import { loadMonthlyActivity } from '../valuation/monthlyActivityStorage';

const amount = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const number = (value: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(value);
const price = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 4 }).format(value);

function MovementDetails({ rows }: { rows: readonly MonthlyActivityRow[] }) {
  return <>
    <div className="table-wrap monthly-activity-table-wrap">
      <ColumnFilterTable pageSize={50} className="inventory-table monthly-activity-table">
        <thead><tr><th>Fecha / tipo</th><th>Producto</th><th>Módulo</th><th>Cantidad</th><th>Lote de destino / persona</th><th>Precio base</th><th>Gasto de salida</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td>{formatMonthlyActivityDate(row.occurredAt)}<small>{row.kind === 'entry' ? 'Entrada' : 'Salida'}</small></td>
          <td data-filter-value={row.product}><strong>{row.product}</strong><small>{row.code || 'Sin código'}{row.reference && row.reference !== 'N/A' ? ` · ${row.reference}` : ''}</small></td>
          <td>{row.moduleName}</td>
          <td className="numeric">{number(row.quantity)} {row.unit}</td>
          <td>{row.destinationLot}<small>{row.recipientName}</small></td>
          <td className="numeric">{row.unitValue === null ? 'Sin precio' : price(row.unitValue)}<small>{row.priceUnit ? `por ${row.priceUnit}` : ''}</small></td>
          <td className="numeric"><strong>{row.kind === 'entry' ? '—' : row.expense === null ? 'No sumada' : amount(row.expense)}</strong>{row.kind === 'exit' && row.issue && <small className="monthly-activity-warning">{row.issue}</small>}</td>
        </tr>)}</tbody>
      </ColumnFilterTable>
    </div>
  </>;
}

export default function MonthlyActivityPanel({ view, summary, items, sources, itemsReady, historyReady }: {
  view: 'movements' | 'expense';
  summary: MonthlyValuationSummary;
  items: MonthlyValuationItem[];
  sources: readonly MonthlyActivitySource[];
  itemsReady: boolean;
  historyReady: boolean;
}) {
  const [stored, setStored] = useState<MonthlyActivitySnapshot | null>(null);
  const [error, setError] = useState('');
  const [grouping, setGrouping] = useState<ExpenseGrouping>('lot');
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [visibleGroups, setVisibleGroups] = useState(30);

  useEffect(() => {
    let active = true;
    setStored(null);
    setError('');
    if (summary.activity) void loadMonthlyActivity(summary.activity)
      .then((snapshot) => { if (active) setStored(snapshot); })
      .catch((cause) => { console.error('No se pudo cargar la actividad del corte:', cause); if (active) setError('No se pudo verificar el detalle guardado. Vuelve a abrir esta vista para reintentar.'); });
    return () => { active = false; };
  }, [summary]);

  const reconstructed = useMemo(() => {
    if (summary.activity || !itemsReady || !historyReady || !summary.createdAt) return null;
    return buildMonthlyActivity(summary.period, items.map((item) => ({ ...item, valuationId: item.id, includesOccupied: false })), sources, summary.createdAt);
  }, [historyReady, items, itemsReady, sources, summary]);
  const snapshot = summary.activity ? stored : reconstructed;
  const totals = useMemo(() => snapshot ? summarizeMonthlyActivity(snapshot.rows) : null, [snapshot]);
  const groups = useMemo(() => snapshot ? groupMonthlyExpenses(snapshot.rows, grouping) : [], [snapshot, grouping]);
  const filteredGroups = groups.filter((group) => `${group.label} ${group.rows.map((row) => `${row.moduleName} ${row.code} ${row.product} ${row.recipientName} ${row.destinationLot}`).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const filteredMovements = snapshot?.rows.filter((row) => (kind === 'all' || row.kind === kind)
    && `${row.moduleName} ${row.code} ${row.product} ${row.recipientName} ${row.destinationLot}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];

  if (error) return <div className="alert-line">{error}</div>;
  if (!snapshot || !totals) return <div className="alert-line notice">{!summary.activity && !summary.createdAt
    ? 'Este corte no tiene fecha verificable; no es posible reconstruir sus movimientos.'
    : 'Esperando el detalle y el historial completo confirmado. No se muestran totales parciales.'}</div>;

  const expenseScope = grouping === 'person' ? snapshot.rows.filter((row) => isPersonnelExpense(row)) : snapshot.rows;
  const scopeTotals = summarizeMonthlyActivity(expenseScope);
  const unitTotals = (type: 'entry' | 'exit') => {
    const units = new Map<string, number>();
    snapshot.rows.filter((row) => row.kind === type).forEach((row) => units.set(row.unit, (units.get(row.unit) ?? 0) + row.quantity));
    return [...units].map(([unit, quantity]) => `${number(quantity)} ${unit}`).join(' · ') || 'Sin movimientos';
  };

  return <section className="monthly-activity">
    <p className="monthly-activity-note"><strong>{summary.activity ? 'Detalle guardado en el corte.' : 'Reconstruido desde el historial actual.'}</strong> Hasta {new Date(snapshot.cutoffAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}. Gasto estimado con los precios unitarios guardados en ese corte; no es costo histórico por salida. Taller excluido.</p>
    {view === 'movements' ? <div className="monthly-activity-kpis">
      <article className="valuation-summary-card valued"><ArrowDownToLine size={24} /><div><span>Entradas del mes</span><strong>{totals.entryCount}</strong><small>{unitTotals('entry')}</small></div></article>
      <article className="valuation-summary-card variation"><ArrowUpFromLine size={24} /><div><span>Salidas del mes</span><strong>{totals.exitCount}</strong><small>{unitTotals('exit')}</small></div></article>
    </div> : <>
      <div className="valuation-tabs monthly-activity-group-tabs" role="tablist" aria-label="Desglosar gasto mensual">
        {([['lot', 'Por lote de destino'], ['module', 'Por módulo'], ['product', 'Por producto'], ['person', 'Dotación y EPP por persona']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={grouping === id} className={grouping === id ? 'active' : ''} onClick={() => { setGrouping(id); setSearch(''); setVisibleGroups(30); }}>{label}</button>)}
      </div>
      <article className="valuation-summary-card total"><CircleDollarSign size={24} /><div><span>{grouping === 'person' ? 'Gasto estimado en Dotación y EPP' : 'Gasto mensual estimado'}</span><strong>{amount(scopeTotals.estimatedExpense)}</strong><small>{scopeTotals.exitCount - scopeTotals.unpricedExitCount} de {scopeTotals.exitCount} salidas valoradas · {scopeTotals.unpricedExitCount} no sumadas</small></div></article>
      <p className="monthly-activity-note">{grouping === 'person' ? 'Agrupado por quien recibió la entrega. Abre una persona para consultar productos, cantidades y fechas.' : 'De mayor a menor gasto. Abre cada grupo para consultar los módulos, productos, cantidades y destinatarios.'}</p>
    </>}
    {(snapshot.invalidDateCount > 0 || snapshot.invalidQuantityCount > 0) && <div className="alert-line">{snapshot.invalidDateCount} registros del historial sin fecha asignable · {snapshot.invalidQuantityCount} registros del mes con cantidad inválida, excluidos.</div>}
    <div className="monthly-activity-filters">
      <label>Buscar<input aria-label="Buscar en actividad mensual" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleGroups(30); }} placeholder="Producto, módulo, lote o persona" /></label>
      {view === 'movements' && <label>Movimiento<select aria-label="Tipo de movimiento mensual" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">Entradas y salidas</option><option value="entry">Entradas</option><option value="exit">Salidas</option></select></label>}
    </div>
    {view === 'movements' ? (filteredMovements.length ? <MovementDetails key={`${summary.period}:${kind}:${search}`} rows={filteredMovements} /> : <p className="valuation-chart-empty">No hay movimientos que coincidan.</p>) : <div className="monthly-expense-groups">
      {filteredGroups.slice(0, visibleGroups).map((group) => <details key={`${grouping}:${group.id}`} className="monthly-expense-group">
        <summary><span><strong>{group.label}</strong><small>{group.rows.length} salidas · {group.unpriced} no sumadas{grouping !== 'person' ? ` · ${scopeTotals.estimatedExpense > 0 ? number(group.expense / scopeTotals.estimatedExpense * 100) : 0}% del gasto` : ''}</small></span><strong>{amount(group.expense)}</strong></summary>
        <MovementDetails rows={group.rows} />
      </details>)}
      {!filteredGroups.length && <p className="valuation-chart-empty">No hay salidas que coincidan en este mes.</p>}
      {visibleGroups < filteredGroups.length && <button type="button" className="monthly-activity-more" onClick={() => setVisibleGroups((count) => count + 30)}>Mostrar 30 grupos más</button>}
    </div>}
  </section>;
}
