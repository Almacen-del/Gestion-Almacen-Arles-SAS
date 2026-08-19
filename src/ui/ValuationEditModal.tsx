import { X } from 'lucide-react';
import type { ValuationSaveState } from '../valuation/models';
import type { ManualValuationConflict } from '../valuation/manualValuation';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}
function formatNumber(value: number) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
}

export default function ValuationEditModal({
  product,
  code,
  unit,
  moduleName,
  quantity,
  value,
  saveState,
  saveBlockedReason,
  conflict,
  onChange,
  onReload,
  onSave,
  onClose,
}: {
  product: string;
  code: string;
  unit: string;
  moduleName: string;
  quantity: number;
  value: string;
  saveState?: ValuationSaveState;
  saveBlockedReason: string;
  conflict?: ManualValuationConflict;
  onChange: (value: string) => void;
  onReload: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const parsedValue = Number(value.replace(',', '.'));
  const previewUnitValue = Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
  const saving = saveState === 'saving';
  const blocked = Boolean(saveBlockedReason) || Boolean(conflict);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="entries-modal valuation-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Editar valor unitario de ${product}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="evidence-header">
          <div>
            <p className="eyebrow">{moduleName} | Valoración unitaria</p>
            <h2>{product}</h2>
            <small>{code} | {formatNumber(quantity)} {unit}</small>
          </div>
          <button className="icon-button" type="button" title="Cerrar" disabled={saving} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form
          className="valuation-modal-body"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="valuation-modal-preview">
            <span>Valor total calculado</span>
            <strong>{formatCurrency(previewUnitValue * quantity)}</strong>
            {moduleName === 'TALLER' && <small>La cantidad incluye unidades disponibles y ocupadas.</small>}
          </div>
          <label className="valuation-modal-field">
            Valor unitario
            <span>
              <strong>$</strong>
              <input
                autoFocus
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={value}
                disabled={saving}
                onChange={(event) => onChange(event.target.value)}
              />
            </span>
          </label>
          {saveState === 'error' && <p className="form-error">Revisa el valor unitario e intenta nuevamente.</p>}
          {conflict && (
            <div className="valuation-conflict" role="alert">
              <strong>Este valor cambió en otro equipo.</strong>
              <span>El valor actual del servidor es {formatCurrency(conflict.current.unitValue)}. No se escribió ningún cambio.</span>
              <button type="button" onClick={onReload}>Recargar valor del servidor</button>
            </div>
          )}
          {saveBlockedReason && <p className="form-error">{saveBlockedReason}</p>}
          <footer className="valuation-modal-actions">
            <button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
            <button className="tool-button" type="submit" disabled={blocked || saving || !value.trim()}>
              {saving ? 'Guardando...' : 'Guardar valor'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
