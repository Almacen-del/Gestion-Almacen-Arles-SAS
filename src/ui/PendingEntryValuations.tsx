import { useMemo, useState, type CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import { AlertTriangle, CheckCircle2, Clock3, Save, WifiOff } from 'lucide-react';
import { moduleAccent } from '../theme';
import {
  DuplicateEntryValuationError,
  InvalidEntryValuationDataError,
  PreviousEntryPendingError,
  saveEntryValuation,
  type EntryStockMovement,
  type EntryValuationRecord,
} from '../valuation/entryValuation';
import {
  calculateWeightedAverage,
  MissingBaseAverageError,
  sequenceEntryValuations,
  type SequencedEntry,
} from '../valuation/entryValuationMath';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 }).format(value)
    : 'Dato inválido';
}

function parseUnitValue(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type EntryRow = SequencedEntry<EntryStockMovement>;

function calculationForRow({
  row,
  record,
  draft,
  currentAverages,
  currentValuationIds,
}: {
  row: EntryRow;
  record?: EntryValuationRecord;
  draft: string;
  currentAverages: Record<string, number>;
  currentValuationIds: ReadonlySet<string>;
}) {
  if (record) {
    return {
      unitValue: record.entryUnitValue,
      total: record.entryUnitValue * row.quantity,
      preview: record.newAverage,
      baseMissing: false,
      inputInvalid: false,
    };
  }

  const unitValue = parseUnitValue(draft);
  const hasBase = currentValuationIds.has(row.valuationId);
  const previousAverage = hasBase ? currentAverages[row.valuationId] ?? 0 : null;
  const baseMissing = row.previousStock > 0 && !hasBase;
  let preview: number | null = null;
  if (unitValue !== null && !row.validationIssue && !baseMissing) {
    try {
      preview = calculateWeightedAverage({
        quantity: row.quantity,
        previousStock: row.previousStock,
        newStock: row.newStock,
        entryUnitValue: unitValue,
        previousAverage,
      });
    } catch {
      preview = null;
    }
  }
  return {
    unitValue,
    total: unitValue === null ? null : unitValue * row.quantity,
    preview,
    baseMissing,
    inputInvalid: Boolean(draft.trim()) && unitValue === null,
  };
}

export default function PendingEntryValuations({
  online,
  user,
  currentAverages,
  currentValuationIds,
  entries,
  records,
  loading,
  loadError,
}: {
  online: boolean;
  user: User;
  currentAverages: Record<string, number>;
  currentValuationIds: ReadonlySet<string>;
  entries: EntryStockMovement[];
  records: Record<string, EntryValuationRecord>;
  loading: boolean;
  loadError: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const valuedMovementIds = useMemo(() => new Set(Object.keys(records)), [records]);
  const sequencedEntries = useMemo(
    () => sequenceEntryValuations(entries, valuedMovementIds),
    [entries, valuedMovementIds],
  );
  const pendingCount = sequencedEntries.filter((entry) => !entry.alreadyValued).length;
  const valuedCount = sequencedEntries.length - pendingCount;

  async function save(row: EntryRow) {
    const draft = drafts[row.id] ?? '';
    const calculation = calculationForRow({
      row,
      draft,
      currentAverages,
      currentValuationIds,
    });
    if (calculation.unitValue === null || calculation.preview === null) return;
    setSavingId(row.id);
    setRowErrors((current) => ({ ...current, [row.id]: '' }));
    try {
      await saveEntryValuation({
        movementId: row.id,
        priorMovementIds: row.priorMovementIds,
        entryUnitValue: calculation.unitValue,
        user,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    } catch (error) {
      console.error('No se pudo valorar la entrada:', error);
      let message = 'No se pudo valorar la entrada. Verifica la conexión y los permisos.';
      if (error instanceof DuplicateEntryValuationError) message = 'Esta entrada ya fue valorada por otro usuario.';
      if (error instanceof PreviousEntryPendingError) message = 'Primero valora la entrada anterior de este producto.';
      if (error instanceof MissingBaseAverageError) message = 'Define primero el promedio inicial en Valor actual.';
      if (error instanceof InvalidEntryValuationDataError) message = error.message;
      setRowErrors((current) => ({ ...current, [row.id]: message }));
    } finally {
      setSavingId('');
    }
  }

  if (loading) {
    return <div className="loading-state valuation-history-loading"><span className="loading-dot" /><span>Cargando entradas por valorar...</span></div>;
  }

  return (
    <section className="entry-valuations-view" aria-label="Entradas por valorar">
      <div className="entry-valuations-heading">
        <div>
          <p className="eyebrow">Promedio ponderado</p>
          <h2>Entradas por valorar</h2>
          <p>Solo aparecen movimientos nuevos marcados como <code>entrada_stock</code>.</p>
        </div>
        <div className="entry-valuations-counters" aria-label="Resumen de estados">
          <span className="pending"><Clock3 size={16} /> {pendingCount} pendientes</span>
          <span className="valued"><CheckCircle2 size={16} /> {valuedCount} valoradas</span>
        </div>
      </div>

      {!online && <div className="alert-line"><WifiOff size={18} />Puedes consultar la caché, pero necesitas conexión para valorar.</div>}
      {loadError && <div className="alert-line"><AlertTriangle size={18} />{loadError}</div>}

      <article className="panel valuation-general-panel entry-valuations-panel">
        <div className="table-wrap valuation-table-wrap entry-valuations-table-wrap">
          <table className="inventory-table valuation-general-table entry-valuations-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Módulo</th>
                <th>Código</th>
                <th>Producto</th>
                <th>Referencia</th>
                <th className="numeric">Cantidad</th>
                <th className="numeric">Stock anterior</th>
                <th className="numeric">Stock nuevo</th>
                <th>Estado</th>
                <th className="numeric">Valor entrada</th>
                <th className="numeric">Total entrada</th>
                <th className="numeric">Nuevo promedio</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {sequencedEntries.map((row) => {
                const record = records[row.id];
                const draft = drafts[row.id] ?? '';
                const calculation = calculationForRow({ row, record, draft, currentAverages, currentValuationIds });
                const blockedMessage = row.blockedByMovementId ? 'Primero valora la entrada anterior' : '';
                const rowIssue = row.validationIssue
                  || blockedMessage
                  || (calculation.baseMissing ? 'Define primero el promedio inicial en Valor actual' : '')
                  || (calculation.inputInvalid ? 'Ingresa un valor no negativo válido' : '')
                  || rowErrors[row.id]
                  || '';
                const disabled = Boolean(
                  record
                  || row.validationIssue
                  || row.blockedByMovementId
                  || calculation.baseMissing
                  || !online
                  || savingId,
                );
                return (
                  <tr key={row.id} className={row.validationIssue ? 'entry-inconsistent' : ''}>
                    <td data-label="Fecha"><span className="entry-date">{row.dateLabel}</span></td>
                    <td data-label="Módulo"><span className="valuation-module-badge" style={{ '--badge-accent': moduleAccent(row.moduleName) } as CSSProperties}>{row.moduleName}</span></td>
                    <td className="code" data-label="Código">{row.code}</td>
                    <td data-label="Producto">{row.product}</td>
                    <td data-label="Referencia">{row.reference}</td>
                    <td className="numeric" data-label="Cantidad">{formatNumber(row.quantity)} {row.unit}</td>
                    <td className="numeric" data-label="Stock anterior">{formatNumber(row.previousStock)}</td>
                    <td className="numeric" data-label="Stock nuevo">{formatNumber(row.newStock)}</td>
                    <td data-label="Estado">
                      <span className={`entry-status ${record ? 'valued' : 'pending'}`}>{record ? 'Valorada' : 'Pendiente'}</span>
                    </td>
                    <td className="numeric entry-value-input-cell" data-label="Valor entrada">
                      <input
                        aria-label={`Valor unitario de ${row.product}`}
                        type="number"
                        min="0"
                        step="any"
                        value={record ? record.entryUnitValue : draft}
                        disabled={disabled}
                        onChange={(event) => {
                          setDrafts((current) => ({ ...current, [row.id]: event.target.value }));
                          setRowErrors((current) => ({ ...current, [row.id]: '' }));
                        }}
                        placeholder="0"
                      />
                    </td>
                    <td className="numeric" data-label="Total entrada">{calculation.total === null ? '—' : formatCurrency(calculation.total)}</td>
                    <td className="numeric entry-average-preview" data-label="Nuevo promedio">{calculation.preview === null ? '—' : formatCurrency(calculation.preview)}</td>
                    <td data-label="Acción" className="entry-action-cell">
                      <button
                        className="tool-button"
                        type="button"
                        disabled={disabled || calculation.unitValue === null || calculation.preview === null}
                        onClick={() => void save(row)}
                      >
                        {record ? <CheckCircle2 size={15} /> : <Save size={15} />}
                        {record ? 'Valorada' : savingId === row.id ? 'Guardando...' : 'Valorar'}
                      </button>
                      {rowIssue && <small className={row.validationIssue ? 'inconsistent' : ''}><AlertTriangle size={13} />{rowIssue}</small>}
                    </td>
                  </tr>
                );
              })}
              {sequencedEntries.length === 0 && (
                <tr><td colSpan={13} className="empty-cell">No hay movimientos entrada_stock para valorar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
