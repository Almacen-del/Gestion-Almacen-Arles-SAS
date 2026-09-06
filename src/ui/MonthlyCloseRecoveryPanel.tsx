import { useEffect, useState } from 'react';
import { currentValuationPeriod, subscribeMonthlyValuationPeriod } from '../valuation/monthlyValuation';
import { isCloseLeaseExpired, recoverAbandonedMonthlyClose } from '../valuation/monthlyCloseLease';
import type { MonthlyValuationSummary } from '../valuation/models';

export default function MonthlyCloseRecoveryPanel({ userUid, online }: { userUid: string; online: boolean }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(currentValuationPeriod());
  const [close, setClose] = useState<MonthlyValuationSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(new Date());
  useEffect(() => { setConfirmation(''); }, [close?.attemptId, close?.status, userUid]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(new Date()), 10000);
    return () => window.clearInterval(timer);
  }, [open]);
  useEffect(() => {
    setClose(null); setConfirmed(false); setConfirmation(''); setMessage('');
    if (!open || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return;
    return subscribeMonthlyValuationPeriod(period, setClose,
      () => { setConfirmed(false); setMessage('No se pudo comprobar el cierre en el servidor.'); },
      (metadata) => setConfirmed(!metadata.fromCache && !metadata.hasPendingWrites));
  }, [period, open]);
  const expired = close?.status === 'guardando' && isCloseLeaseExpired(close.lastProgressAt ?? null, now);
  const canRecover = online && confirmed && expired && !!close?.attemptId
    && confirmation.trim() === `RECUPERAR ${period}` && !busy;
  async function recover() {
    if (!canRecover || !close?.attemptId) return;
    setBusy(true); setMessage('Comprobando intento y plazo en el servidor...');
    try {
      await recoverAbandonedMonthlyClose({ period, attemptId: close.attemptId, userUid, confirmation });
      setConfirmation('');
      setMessage('Intento interrumpido liberado y registrado. No se eliminaron sus datos ni se creó un cierre. Reintenta el corte del mes; si es anterior, revisa la reconstrucción histórica antes de guardarla.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo recuperar. Actualiza el estado.');
    } finally { setBusy(false); }
  }
  return <details className="monthly-activity-note" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Recuperar un cierre mensual interrumpido</summary>
    <p>Solo permite liberar intentos con al menos 15 minutos sin actividad. Nunca modifica cierres completos. La recuperación queda registrada y el reintento requiere una nueva revisión.</p>
    <label>Mes del cierre <input type="month" value={period} disabled={busy} onChange={(event) => setPeriod(event.target.value)} /></label>
    <p role="status">{!confirmed ? 'Esperando estado confirmado del servidor.' : !close ? 'No existe un cierre para este mes.'
      : close.status === 'completo' ? 'Cierre completo e inmutable: no se puede recuperar.'
      : close.status === 'error' ? 'El intento está en error; ya no está bloqueado por un guardado activo.'
      : !close.lastProgressAt ? 'Sin fecha verificable: requiere revisión técnica; no se libera automáticamente.'
      : expired ? 'El intento no ha registrado actividad durante al menos 15 minutos.' : 'El cierre sigue activo. Espera a que termine.'}</p>
    {expired && <label>Escribe RECUPERAR {period} <input aria-label="Confirmación de recuperación" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>}
    <button type="button" className="tool-button" disabled={!canRecover} onClick={() => { void recover(); }}>Liberar intento interrumpido</button>
    {message && <p role="status">{message}</p>}
  </details>;
}
