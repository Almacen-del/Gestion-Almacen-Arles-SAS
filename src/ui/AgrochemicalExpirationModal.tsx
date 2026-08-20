import { useMemo, useState } from 'react';
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

export type AgrochemicalLotRegistration = {
  productDocumentId: string;
  lotNumber: string;
  expirationDate: string;
  quantity: number;
  receivedAt: string;
  sourceEntryId?: string;
};

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
  products,
  lots,
  entries,
  loading,
  sourceError,
  onRegister,
  onClose,
}: {
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
  const [lotNumber, setLotNumber] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const [receivedAt, setReceivedAt] = useState(today);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

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
  const unassignedQuantity = selectedProduct
    ? Math.max(0, selectedProduct.stock - (lotQuantityByProduct.get(selectedProduct.id) ?? 0))
    : 0;
  const registrationLimit = selectedEntry
    ? Math.min(selectedEntry.pendingQuantity, unassignedQuantity)
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
    setFormError('');
    setSavedMessage('');
    const parsedQuantity = Number(quantity.replace(',', '.'));
    if (loading || sourceError) return setFormError('Espera hasta confirmar la lectura completa de los lotes existentes.');
    if (!selectedProduct) return setFormError('Selecciona un producto.');
    if (!lotNumber.trim()) return setFormError('Escribe el número de lote.');
    if (!expirationDate) return setFormError('Selecciona la fecha de vencimiento.');
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return setFormError('La cantidad debe ser mayor que cero.');
    if (parsedQuantity > unassignedQuantity) {
      return setFormError(`Solo hay ${formatQuantity(unassignedQuantity)} ${selectedProduct.unit} sin asignar a lote.`);
    }
    if (selectedEntry && parsedQuantity > selectedEntry.pendingQuantity + 1e-7) {
      return setFormError(`La entrada solo tiene ${formatQuantity(selectedEntry.pendingQuantity)} ${selectedEntry.unit} pendientes.`);
    }
    setSaving(true);
    try {
      await onRegister({
        productDocumentId: selectedProduct.id,
        lotNumber: lotNumber.trim(),
        expirationDate,
        quantity: parsedQuantity,
        receivedAt,
        sourceEntryId: selectedEntry?.id,
      });
      setSavedMessage(`Lote ${lotNumber.trim()} registrado sin modificar el saldo general.`);
      setLotNumber('');
      setExpirationDate('');
      setQuantity('');
      setSelectedEntryId('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo registrar el lote.');
    } finally {
      setSaving(false);
    }
  }

  function selectPendingEntry(entryId: string) {
    const entry = entryQueue.find((candidate) => candidate.id === entryId);
    if (!entry || entry.assignmentStatus === 'invalid' || entry.assignmentStatus === 'assigned') return;
    setSelectedEntryId(entry.id);
    setProductDocumentId(entry.productDocumentId);
    setQuantity(String(entry.pendingQuantity));
    setReceivedAt(entry.dateKey || today);
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
                      disabled={entry.assignmentStatus === 'invalid'}
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
            <form onSubmit={submit}>
              <label>Producto
                <select
                  value={productDocumentId}
                  disabled={Boolean(selectedEntry)}
                  onChange={(event) => { setSelectedEntryId(''); setProductDocumentId(event.target.value); setQuantity(''); }}
                >
                  <option value="">Seleccionar producto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.code} · {product.name}</option>
                  ))}
                </select>
                {selectedEntry && <small>Entrada: {selectedEntry.id}</small>}
              </label>
              <label>Número de lote
                <input value={lotNumber} onChange={(event) => setLotNumber(event.target.value)} placeholder="Ej. L-2026-08" />
              </label>
              <label>Fecha de vencimiento
                <input type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} />
              </label>
              <label>Cantidad del lote
                <input type="number" min="0.01" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                {selectedProduct && <small>{selectedEntry ? 'Pendiente de esta entrada' : 'Sin asignar'}: {formatQuantity(registrationLimit)} {selectedProduct.unit}</small>}
              </label>
              <label>Fecha de ingreso
                <input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
              </label>
              <button type="submit" disabled={saving || loading || Boolean(sourceError) || registrationLimit <= 0}>{saving ? 'Guardando...' : 'Registrar lote'}</button>
            </form>
            {selectedEntry && <button className="agro-clear-entry" type="button" onClick={() => { setSelectedEntryId(''); setProductDocumentId(''); setQuantity(''); }}>Cancelar selección de entrada</button>}
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
                <table className="agro-expiration-table">
                  <thead><tr><th>Producto</th><th>Lote</th><th>Ingreso</th><th>Vencimiento</th><th>Días</th><th>Cantidad</th><th>Ubicación</th><th>Estado</th></tr></thead>
                  <tbody>{sortedLots.map((lot) => {
                    const product = productById.get(lot.productDocumentId);
                    const status = classifyAgrochemicalLot(lot, today);
                    const days = daysUntilExpiration(lot.expirationDate, today);
                    return <tr key={`${lot.productDocumentId}-${lot.id}`}>
                      <td><strong>{product?.code || lot.productCode}</strong><span>{product?.name || lot.productName}</span></td>
                      <td>{lot.lotNumber}</td><td>{lot.receivedAt || 'Sin fecha'}</td><td>{lot.expirationDate || 'Sin fecha'}</td>
                      <td>{days === null ? 'N/A' : days}</td><td>{formatQuantity(lot.quantity)} {lot.unit}</td>
                      <td>{lot.location || product?.location || 'Sin ubicación'}</td>
                      <td><span className={`agro-lot-status ${status}`}>{STATUS_LABELS[status]}</span></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
