import React, { useState } from 'react';

export default function AssignQrModal({
  open,
  item,
  onClose,
  onApply,
}: {
  open: boolean;
  item?: any;
  onClose: () => void;
  onApply: (qr: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState('');
  if (!open || !item) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="evidence-modal" role="dialog" aria-modal="true" aria-label="Asignar QR" onClick={(e) => e.stopPropagation()}>
        <header className="evidence-header">
          <div>
            <p className="eyebrow">Asignar QR</p>
            <h2>{item.descripcion}</h2>
          </div>
          <button className="icon-button" type="button" title="Cerrar" onClick={onClose}>×</button>
        </header>

        <div className="evidence-body" style={{ padding: 18 }}>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Código QR (solo números)
            <input value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '100%', padding: 10, marginTop: 6 }} />
          </label>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Al confirmar se actualizará el documento en Firestore con `codigo_qr` y `requiere_asignar_qr: false`.</p>
        </div>

        <footer className="evidence-footer">
          <div />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="tool-button" type="button" onClick={onClose}>Cancelar</button>
            <button className="tool-button" type="button" onClick={() => onApply(value)} disabled={!value.trim()}>Aplicar</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
