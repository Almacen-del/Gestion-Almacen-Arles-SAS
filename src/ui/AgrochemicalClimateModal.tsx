import { useEffect, useRef, useState } from 'react';
import { webSupabaseClient } from '../backend/supabase/runtime';
import { X, Thermometer } from 'lucide-react';
import { AGROQUIMICOS_UBICACIONES } from '../agroquimicosCanonicos';
import './agrochemicalClimate.css';

type Reading = { id: string; location: string; temperature_c: number; humidity_percent: number;
  measured_at: string; created_by: string; responsible_name: string; notes: string };

export default function AgrochemicalClimateModal({ onClose }: { onClose: () => void }) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const { data, error } = await webSupabaseClient().rpc('climate_readings_page', { p_location: location || null, p_before: null, p_limit: 500 });
        if (!active) return;
        if (error) throw error;
        setReadings(data ?? []); setError('');
      } catch { if (active) { setReadings([]); setError('No se pudieron consultar los registros. Verifica la conexión y el acceso al control ambiental.'); } }
      finally { fetching = false; if (active) setLoading(false); }
    };
    setLoading(true); setReadings([]); void refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [location, refreshKey]);
  const visible = readings.filter(reading => !location || reading.location === location);
  return <div className="modal-backdrop">
    <section ref={dialog} tabIndex={-1} className="agro-expiration-modal climate-modal" role="dialog" aria-modal="true" aria-labelledby="climate-title"
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select');
          if (!controls?.length) return;
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header className="evidence-header"><div><p className="eyebrow">Agroquímicos | Control ambiental</p>
        <h2 id="climate-title"><Thermometer size={22} /> Temperatura y humedad</h2>
        <small>Mediciones manuales registradas desde la aplicación Android.</small></div>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="agro-expiration-body">
        <label>Ubicación <select value={location} onChange={event => setLocation(event.target.value)}>
          <option value="">Todas las ubicaciones</option>{AGROQUIMICOS_UBICACIONES.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <button type="button" className="agro-expiration-button" disabled={loading} onClick={() => setRefreshKey(value => value + 1)}>Actualizar registros</button>
        <p>Últimos 500 registros de la ubicación seleccionada. Actualización cada 30 segundos. Fecha y hora de Colombia.</p>
        {error && <p role="alert">{error}</p>}
        {loading ? <p role="status">Cargando mediciones…</p> : !error && visible.length === 0 ? <p>No hay mediciones registradas para esta ubicación.</p> : null}
        <div className="climate-readings">{visible.map(reading => <article key={reading.id} className="agro-expiration-register">
          <strong>{reading.location}</strong>
          <p>{new Date(reading.measured_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>
          <div className="climate-values"><span>{reading.temperature_c} °C<small>Temperatura</small></span><span>{reading.humidity_percent} %<small>Humedad relativa</small></span></div>
          {reading.notes && <p>{reading.notes}</p>}<small>Responsable: {reading.responsible_name}</small>
        </article>)}</div>
      </div>
    </section>
  </div>;
}
