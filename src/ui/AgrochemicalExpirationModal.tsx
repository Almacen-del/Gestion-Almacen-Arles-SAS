import ColumnFilterTable from './ColumnFilterTable';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearLotAttempt, isDefinitiveLotRejection, prepareLotAttempt, readLotAttempt,
  type AgrochemicalLotRegistration, type LotRegistrationIntent,
} from '../agrochemicalRegistration';
import { AlertTriangle, CalendarClock, PackageCheck, X } from 'lucide-react';
import {
  buildAgrochemicalEntryQueue,
  classifyAgrochemicalLot,
  daysUntilExpiration,
  sortAgrochemicalLotsByFefo,
  type AgrochemicalLot,
  type AgrochemicalLotStatus,
  type AgrochemicalStockEntry,
} from '../agrochemicalLots';

export type AgrochemicalExpirationProduct = {
  id: string;
  code: string;
  name: string;
  stock: number;
  unit: string;
  location: string;
};

export type { AgrochemicalLotRegistration } from '../agrochemicalRegistration';

const STATUS_LABELS: Record<AgrochemicalLotStatus, string> = {
  expired: 'Vencido / revisar',
  'near-expiry': 'Próximo a vencer',
  valid: 'Vigente',
  empty: 'Agotado',
  'missing-date': 'Sin fecha',
};

function localDateKey() {
  const current = new Date();
  const offset = current.getTimezoneOffset() * 60_000;
  return new Date(current.getTime() - offset).toISOString().slice(0, 10);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
}

export default function AgrochemicalExpirationModal({
  canRegister = false,
  registrationScope,
  products,
  lots,
  entries,
  loading,
  sourceError,
  onRegister,
  onClose,
}: {
  canRegister?: boolean;
  registrationScope: string;
  products: AgrochemicalExpirationProduct[];
  lots: AgrochemicalLot[];
  entries: AgrochemicalStockEntry[];
  loading: boolean;
  sourceError: string;
  onRegister: (registration: AgrochemicalLotRegistration) => Promise<void>;
  onClose: () => void;
}) {
  const today = localDateKey();
  const [productDocumentId, setProductDocumentId] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [selectedExistingLotId, setSelectedExistingLotId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [expirationPrecision, setExpirationPrecision] = useState<'day' | 'month'>('day');
  const [expirationDate, setExpirationDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [receivedAt, setReceivedAt] = useState(today);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [entryMode, setEntryMode] = useState<'' | 'add' | 'link'>('');
  const [pendingAttempt, setPendingAttempt] = useState<AgrochemicalLotRegistration | null>(null);
  const [storageError, setStorageError] = useState('');
  const submitting = useRef(false);
  useEffect(() => {
    const refresh = () => {
      try { setPendingAttempt(readLotAttempt(localStorage, registrationScope)); setStorageError(''); }
      catch { setStorageError('No se pudo leer el comprobante local. No registres otra asignación hasta revisar este navegador.'); }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [registrationScope]);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const sortedLots = useMemo(() => sortAgrochemicalLotsByFefo(lots), [lots]);
  const entryQueue = useMemo(() => buildAgrochemicalEntryQueue(entries, lots), [entries, lots]);
  const pendingEntries = entryQueue.filter((entry) => entry.assignmentStatus !== 'assigned');
  const selectedEntry = entryQueue.find((entry) => entry.id === selectedEntryId);
  const lotQuantityByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    lots.forEach((lot) => totals.set(
      lot.productDocumentId,
      (totals.get(lot.productDocumentId) ?? 0) + Math.max(0, lot.quantity),
    ));
    return totals;
  }, [lots]);
  const selectedProduct = productById.get(productDocumentId);
  const existingLotsForSelectedProduct = useMemo(() => sortedLots.filter((lot) => (
    lot.productDocumentId === productDocumentId
  )), [productDocumentId, sortedLots]);
  const selectedExistingLot = existingLotsForSelectedProduct.find((lot) => lot.id === selectedExistingLotId);
  const unassignedQuantity = selectedProduct
    ? Math.max(0, selectedProduct.stock - (lotQuantityByProduct.get(selectedProduct.id) ?? 0))
    : 0;
  const linkingExistingLotWithoutStockIncrease = Boolean(selectedEntry && selectedExistingLot && entryMode === 'link');
  const registrationLimit = selectedEntry
    ? selectedEntry.pendingQuantity
    : unassignedQuantity;
  const statusCounts = useMemo(() => sortedLots.reduce<Record<AgrochemicalLotStatus, number>>((counts, lot) => {
    const status = classifyAgrochemicalLot(lot, today);
    counts[status] += 1;
    return counts;
  }, { expired: 0, 'near-expiry': 0, valid: 0, empty: 0, 'missing-date': 0 }), [sortedLots, today]);
  const uncoveredProducts = products.filter((product) => (
    product.stock > (lotQuantityByProduct.get(product.id) ?? 0)
  ));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || saving) return;
    if (!canRegister) return setFormError('Solo un administrador o almacenista puede asignar lotes.');
    setFormError('');
    setSavedMessage('');
    const parsedQuantity = Number(quantity.replace(',', '.'));
    if (loading || sourceError) return setFormError('Espera hasta confirmar la lectura completa de los lotes existentes.');
    if (!selectedProduct) return setFormError('Selecciona un producto.');
    if (!lotNumber.trim()) return setFormError('Escribe el número de lote.');
    if (!expirationDate) return setFormError('Selecciona la fecha de vencimiento.');
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return setFormError('La cantidad debe ser mayor que cero.');
    if (!selectedEntry && parsedQuantity > unassignedQuantity) {
      return setFormError(`Solo hay ${formatQuantity(unassignedQuantity)} ${selectedProduct.unit} sin asignar a lote.`);
    }
    if (selectedEntry && parsedQuantity > selectedEntry.pendingQuantity + 1e-7) {
      return setFormError(`La entrada solo tiene ${formatQuantity(selectedEntry.pendingQuantity)} ${selectedEntry.unit} pendientes.`);
    }
    if (selectedEntry && selectedExistingLot && !entryMode) {
      return setFormError('Indica si esta entrada es nueva o si su cantidad ya estaba contabilizada en el lote.');
    }
    await sendAttempt({
      productDocumentId: selectedProduct.id,
      existingLotId: selectedExistingLot?.id,
      lotNumber: lotNumber.trim(), expirationDate, quantity: parsedQuantity, receivedAt,
      sourceEntryId: selectedEntry?.id,
      linkExistingLotWithoutStockIncrease: linkingExistingLotWithoutStockIncrease,
    });
  }

  async function sendAttempt(intent?: LotRegistrationIntent) {
    if (submitting.current || !canRegister || storageError) return;
    submitting.current = true;
    setSaving(true);
    setFormError('');
    setSavedMessage('');
    try {
      if (!navigator.locks) throw new Error('Este navegador no permite proteger el reintento. Usa una versión actual de Chrome o Edge.');
      await navigator.locks.request(`arles-lot:${registrationScope}`, async () => {
        const attempt = intent ? prepareLotAttempt(localStorage, registrationScope, intent)
          : readLotAttempt(localStorage, registrationScope);
        if (!attempt) return;
        setPendingAttempt(attempt);
        try {
          await onRegister(attempt);
        } catch (error) {
          // A rejection of a *replay* does not prove the original request failed
          // (e.g. the role could have been revoked after the original commit).
          if (intent && isDefinitiveLotRejection(error)) {
            clearLotAttempt(localStorage, registrationScope, attempt.operationId);
            setPendingAttempt(null);
          }
          throw error;
        }
        clearLotAttempt(localStorage, registrationScope, attempt.operationId);
        setPendingAttempt(null);
        setSavedMessage(attempt.linkExistingLotWithoutStockIncrease
          ? `Entrada vinculada al lote ${attempt.lotNumber} sin aumentar su saldo.`
          : `Lote ${attempt.lotNumber} registrado sin modificar el saldo general.`);
        setLotNumber(''); setExpirationDate(''); setQuantity('');
        setSelectedEntryId(''); setSelectedExistingLotId(''); setEntryMode('');
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo registrar el lote.');
    } finally {
      setSaving(false);
      submitting.current = false;
    }
  }

  function selectPendingEntry(entryId: string) {
    const entry = entryQueue.find((candidate) => candidate.id === entryId);
    if (!entry || entry.assignmentStatus === 'invalid' || entry.assignmentStatus === 'assigned') return;
    setSelectedEntryId(entry.id);
    setEntryMode('');
    setSelectedExistingLotId('');
    setProductDocumentId(entry.productDocumentId);
    setQuantity(String(entry.pendingQuantity));
    setReceivedAt(entry.dateKey || today);
    setFormError('');
    setSavedMessage('');
  }

  function selectExistingLot(lotId: string) {
    setEntryMode('');
    setSelectedExistingLotId(lotId);
    const existingLot = existingLotsForSelectedProduct.find((lot) => lot.id === lotId);
    if (!existingLot) return;
    setLotNumber(existingLot.lotNumber);
    setExpirationPrecision(existingLot.expirationDate.length === 7 ? 'month' : 'day');
    setExpirationDate(existingLot.expirationDate);
    setFormError('');
    setSavedMessage('');
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="agro-expiration-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Fechas de vencimiento de agroquímicos"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="evidence-header">
          <div>
            <p className="eyebrow">Agroquímicos | Control por lote</p>
            <h2>Fechas de vencimiento</h2>
            <small>Cada fecha pertenece a un lote independiente. La web no registra ni descuenta salidas.</small>
          </div>
          <button className="icon-button" type="button" title="Cerrar" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="agro-expiration-body">
          {!canRegister && <p role="status">Modo consulta: la asignación de lotes está reservada a administradores y almacenistas.</p>}
          <section className="agro-expiration-kpis" aria-label="Resumen de vencimientos">
            <article className="expired"><AlertTriangle size={19} /><span>Vencidos</span><strong>{statusCounts.expired}</strong></article>
            <article className="near"><CalendarClock size={19} /><span>Próximos 30 días</span><strong>{statusCounts['near-expiry']}</strong></article>
            <article className="valid"><PackageCheck size={19} /><span>Vigentes</span><strong>{statusCounts.valid}</strong></article>
            <article><AlertTriangle size={19} /><span>Stock sin lote</span><strong>{uncoveredProducts.length}</strong></article>
          </section>

          <section className="agro-pending-entries">
            <header>
              <div><p className="eyebrow">Entradas desde el celular</p><h3>Entradas pendientes de lote</h3></div>
              <strong>{pendingEntries.length}</strong>
            </header>
            {pendingEntries.length === 0 ? (
              <p className="agro-expiration-empty">No hay entradas nuevas de Agroquímicos pendientes de lote.</p>
            ) : (
              <div className="agro-pending-entry-grid">
                {pendingEntries.map((entry) => (
                  <article className={`agro-pending-entry ${entry.assignmentStatus}`} key={entry.id}>
                    <div><strong>{entry.code} · {entry.productName}</strong><span>{entry.dateLabel}</span></div>
                    <div><span>Pendiente</span><strong>{formatQuantity(entry.pendingQuantity)} {entry.unit}</strong></div>
                    {entry.validationIssue && <small>{entry.validationIssue}</small>}
                    <button
                      type="button"
                      disabled={!canRegister || saving || Boolean(pendingAttempt) || Boolean(storageError) || entry.assignmentStatus === 'invalid'}
                      onClick={() => selectPendingEntry(entry.id)}
                    >
                      {entry.assignmentStatus === 'partial' ? 'Completar asignación' : 'Asignar lote'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="agro-expiration-register">
            <div>
              <p className="eyebrow">Nuevo registro</p>
              <h3>Asignar vencimiento a un lote</h3>
              <small>Primero debe existir el producto y su saldo, registrado desde la aplicación móvil.</small>
            </div>
            {pendingAttempt && <div role="status" className="agro-expiration-message">
              <p>Hay una asignación por confirmar: {pendingAttempt.lotNumber} · {formatQuantity(pendingAttempt.quantity)}.
                El reintento consulta el mismo comprobante y no duplica la cantidad.</p>
              <button type="button" disabled={!canRegister || saving || Boolean(storageError)} onClick={() => void sendAttempt()}>
                {saving ? 'Comprobando...' : 'Comprobar / reintentar asignación pendiente'}
              </button>
            </div>}
            {storageError && <p role="alert">{storageError}</p>}
            <form onSubmit={submit}>
              <fieldset disabled={!canRegister || saving || Boolean(pendingAttempt) || Boolean(storageError)} style={{ display: 'contents' }}>
              <label>Producto
                <select
                  value={productDocumentId}
                  disabled={Boolean(selectedEntry)}
                  onChange={(event) => {
                    setSelectedEntryId('');
                    setSelectedExistingLotId('');
                    setProductDocumentId(event.target.value);
                    setLotNumber('');
                    setExpirationDate('');
                    setQuantity('');
                  }}
                >
                  <option value="">Seleccionar producto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.code} · {product.name}</option>
                  ))}
                </select>
                {selectedEntry && <small>Entrada: {selectedEntry.id}</small>}
              </label>
              {existingLotsForSelectedProduct.length > 0 && (
                <label className="agro-existing-lot">Reutilizar lote registrado
                  <select value={selectedExistingLotId} onChange={(event) => selectExistingLot(event.target.value)}>
                    <option value="">Escribir un lote nuevo</option>
                    {existingLotsForSelectedProduct.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.lotNumber} · FV {lot.expirationDate} · {formatQuantity(lot.quantity)} {lot.unit}
                      </option>
                    ))}
                  </select>
                  <small>Se conserva la identidad y el vencimiento del lote seleccionado.</small>
                </label>
              )}
              {selectedEntry && selectedExistingLot && <label>Tratamiento de esta entrada
                <select value={entryMode} onChange={event => setEntryMode(event.target.value as '' | 'add' | 'link')}>
                  <option value="">Selecciona cómo contabilizarla</option>
                  <option value="add">Entrada nueva: sumar cantidad al lote</option>
                  <option value="link">Cantidad ya incluida: vincular sin sumar</option>
                </select>
                <small>Ambas opciones usan la cantidad original de la entrada. Ninguna modifica el saldo general.</small>
              </label>}
              <label>Número de lote
                <input value={lotNumber} onChange={(event) => { setSelectedExistingLotId(''); setLotNumber(event.target.value); }} placeholder="Ej. L-2026-08" />
              </label>
              <label>Fecha de vencimiento
                <select
                  value={expirationPrecision}
                  onChange={(event) => {
                    setSelectedExistingLotId('');
                    setExpirationPrecision(event.target.value as 'day' | 'month');
                    setExpirationDate('');
                  }}
                >
                  <option value="day">Día exacto</option>
                  <option value="month">Solo mes (según etiqueta)</option>
                </select>
                <input
                  type={expirationPrecision === 'month' ? 'month' : 'date'}
                  value={expirationDate}
                  onChange={(event) => { setSelectedExistingLotId(''); setExpirationDate(event.target.value); }}
                />
              </label>
              <label>Cantidad del lote
                <input type="number" min="0.01" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                {selectedProduct && <small>{linkingExistingLotWithoutStockIncrease
                  ? `Pendiente de esta entrada: ${formatQuantity(registrationLimit)} ${selectedProduct.unit}. Se vinculará al lote sin aumentar su saldo.`
                  : `${selectedEntry ? 'Pendiente de esta entrada' : 'Sin asignar'}: ${formatQuantity(registrationLimit)} ${selectedProduct.unit}`}</small>}
              </label>
              <label>Fecha de ingreso
                <input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
              </label>
              <button type="submit" title={!canRegister ? 'Solo un administrador o almacenista puede asignar lotes.' : ''} disabled={!canRegister || saving || loading || Boolean(sourceError) || registrationLimit <= 0}>{saving ? 'Guardando...' : 'Registrar lote'}</button>
              </fieldset>
            </form>
            {selectedEntry && <button className="agro-clear-entry" type="button" onClick={() => { setSelectedEntryId(''); setSelectedExistingLotId(''); setProductDocumentId(''); setLotNumber(''); setExpirationDate(''); setQuantity(''); }}>Cancelar selección de entrada</button>}
            {formError && <p className="agro-expiration-message error">{formError}</p>}
            {savedMessage && <p className="agro-expiration-message success">{savedMessage}</p>}
          </section>

          <section className="agro-expiration-table-section">
            <header>
              <div><p className="eyebrow">Orden FEFO</p><h3>Lotes ordenados por vencimiento</h3></div>
              <small>La app móvil deberá descontar en este orden: primero vence, primero sale.</small>
            </header>
            {sourceError && <p className="agro-expiration-message error">{sourceError}</p>}
            {loading ? <p className="agro-expiration-empty">Cargando lotes...</p> : sortedLots.length === 0 ? (
              <p className="agro-expiration-empty">Aún no hay lotes registrados. Los {uncoveredProducts.length} productos con stock deben asignarse por lote cuando se conozca su vencimiento.</p>
            ) : (
              <div className="table-wrap">
                <ColumnFilterTable className="agro-expiration-table">
                  <thead><tr><th>Producto</th><th>Lote</th><th>Ingreso</th><th>Vencimiento</th><th>Días</th><th>Cantidad</th><th>Ubicación</th><th>Estado</th></tr></thead>
                  <tbody>{sortedLots.map((lot) => {
                    const product = productById.get(lot.productDocumentId);
                    const status = classifyAgrochemicalLot(lot, today);
                    const days = daysUntilExpiration(lot.expirationDate, today);
                    return <tr key={`${lot.productDocumentId}-${lot.id}`}>
                      <td data-filter-value={product?.name || lot.productName}><strong>{product?.code || lot.productCode}</strong><span>{product?.name || lot.productName}</span></td>
                      <td>{lot.lotNumber}</td><td>{lot.receivedAt || 'Sin fecha'}</td><td>{lot.expirationDate ? `${lot.expirationDate}${lot.expirationDate.length === 7 ? ' (fin de mes)' : ''}` : 'Sin fecha'}</td>
                      <td>{days === null ? 'N/A' : days}</td><td>{formatQuantity(lot.quantity)} {lot.unit}</td>
                      <td>{lot.location || product?.location || 'Sin ubicación'}</td>
                      <td><span className={`agro-lot-status ${status}`}>{STATUS_LABELS[status]}</span></td>
                    </tr>;
                  })}</tbody>
                </ColumnFilterTable>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
