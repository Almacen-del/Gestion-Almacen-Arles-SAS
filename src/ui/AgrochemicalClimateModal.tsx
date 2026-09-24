import { useEffect, useMemo, useRef, useState } from 'react';
import { webSupabaseClient } from '../backend/supabase/runtime';
import { climateLabels, climateRange, colombiaDateTime, criteriaForReading, evaluateClimate, type ClimateCriteria, type ClimateDashboard, type ClimateReading, type ClimateRule } from '../backend/supabase/climate';
import { X, Thermometer } from 'lucide-react';
import './agrochemicalClimate.css';

const number = (v: number) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const time = (v: string) => new Date(v).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
function ProductConditions({ criteria, t, h, code = '' }: { criteria: ClimateCriteria; t: number; h: number; code?: string }) {
  const evaluated = criteria.rules.filter(r => !code || r.code === code).map(rule => ({ rule, ...evaluateClimate(rule, t, h, criteria.reference) }));
  const order = { outside: 0, unknown: 1, reference: 2, within: 3 };
  return <><div className="climate-summary" aria-live="polite">{Object.entries(climateLabels).map(([status, label]) => <div key={status} className={`climate-status ${status}`}><strong>{evaluated.filter(r => r.status === status).length}</strong><span>{label}</span></div>)}</div>
    <div className="climate-products">{evaluated.sort((a, b) => order[a.status] - order[b.status] || a.rule.name.localeCompare(b.rule.name)).map(({ rule, status, reasons }) => <details className={`climate-product ${status}`} key={rule.code}>
      <summary><span><b>{rule.name}</b><small>{rule.code}</small></span><span className={`climate-badge ${status}`}>{climateLabels[status]}</span></summary>
      {reasons.length > 0 && <ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <p><b>Ficha:</b> {rule.temperature_text} · {rule.humidity_text}</p><p>{rule.details}</p>
      {status !== 'within' && criteria.reference && <p>Los parámetros sin límite numérico usan la referencia preventiva interna. No es una certificación del estado del producto.</p>}
      <small>{criteria.source} · página {rule.page}</small>
    </details>)}</div></>;
}
function ClimateChart({ readings, metric, rule, criteria, from, to }: { readings: ClimateReading[]; metric: 'temperature_c' | 'humidity_percent'; rule?: ClimateRule; criteria?: ClimateCriteria; from: string; to: string }) {
  const temperature = metric === 'temperature_c';
  const title = temperature ? 'Temperatura (°C)' : 'Humedad relativa (%)';
  const limits: { value: number; label: string }[] = [];
  if (rule && criteria) {
    if (temperature) {
      const has = rule.t_min !== null || rule.t_max !== null;
      const low = has ? rule.t_min : criteria.reference?.t_min;
      const high = has ? rule.t_max : criteria.reference?.t_max;
      if (low != null) limits.push({ value: low, label: `Mín. ${low}${has ? '' : ' ref.'}` });
      if (high != null) limits.push({ value: high, label: `Máx. ${high}${has ? '' : ' ref.'}` });
    } else {
      const high = rule.h_max ?? criteria.reference?.h_max;
      if (high != null) limits.push({ value: high, label: `${rule.h_max === null ? '<' : '≤'} ${high} %${rule.h_max === null ? ' ref.' : ''}` });
    }
  }
  const values = readings.map(r => Number(r[metric]));
  const low = temperature ? Math.floor(Math.min(...values, ...limits.map(l => l.value), 20) - 3) : 0;
  const high = temperature ? Math.ceil(Math.max(...values, ...limits.map(l => l.value), 30) + 3) : 100;
  const start = new Date(`${from}T00:00:00-05:00`).getTime(), end = new Date(`${to}T23:59:59-05:00`).getTime();
  const x = (r: ClimateReading) => 48 + (new Date(r.measured_at).getTime() - start) / (end - start) * 550;
  const y = (v: number) => 170 - (v - low) / (high - low) * 135;
  return <section className="climate-chart"><h3>{title}</h3>{!readings.length ? <p>Sin mediciones en este periodo.</p> : <>
    <svg viewBox="0 0 660 205" role="img" aria-label={`${title}: ${readings.length} mediciones. Valores exactos en el historial.`}>
      {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1="48" x2="610" y1={y(low + f * (high - low))} y2={y(low + f * (high - low))} stroke="#dce5de" /><text x="40" y={y(low + f * (high - low)) + 4} textAnchor="end">{number(low + f * (high - low))}</text></g>)}
      {limits.map(l => <g key={l.label}><line x1="48" x2="610" y1={y(l.value)} y2={y(l.value)} stroke="#a45c00" strokeDasharray="5 4" /><text x="605" y={y(l.value) - 5} textAnchor="end">{l.label}</text></g>)}
      {readings.map((r, i) => <g key={r.id}>{i > 0 && new Date(r.measured_at).getTime() - new Date(readings[i - 1].measured_at).getTime() <= 18 * 3600000 && <line x1={x(readings[i - 1])} y1={y(Number(readings[i - 1][metric]))} x2={x(r)} y2={y(Number(r[metric]))} stroke={temperature ? '#157f55' : '#2874a6'} strokeWidth="2" />}
        <circle cx={x(r)} cy={y(Number(r[metric]))} r="4" fill={temperature ? '#157f55' : '#2874a6'}><title>{time(r.measured_at)} · {r.period}: {number(r[metric])} {temperature ? '°C' : '%'}</title></circle></g>)}
      <text x="48" y="195">{from}</text><text x="610" y="195" textAnchor="end">{to}</text>
    </svg><small>Mín. {number(Math.min(...values))} · Promedio {number(values.reduce((a, b) => a + b, 0) / values.length)} · Máx. {number(Math.max(...values))}</small></>}
  </section>;
}

function ProductHistoryChart({ readings, dashboard, code }: { readings: ClimateReading[]; dashboard: ClimateDashboard; code: string }) {
  if (!readings.length) return null;
  const colors = { outside: '#c74438', within: '#26864c', reference: '#4b85ac', unknown: '#c29432' };
  return <section className="climate-chart climate-product-history"><h3>{code ? 'Condiciones del producto por registro' : 'Condiciones de todos los productos por registro'}</h3><div className="climate-legend">{Object.entries(colors).map(([status, color]) => <span key={status}><i style={{ background: color }} />{climateLabels[status as keyof typeof climateLabels]}</span>)}</div>
    <div className="climate-bars">{readings.map(r => {
      const c = criteriaForReading(r, dashboard);
      const states = c?.rules.filter(item => !code || item.code === code).map(item => evaluateClimate(item, Number(r.temperature_c), Number(r.humidity_percent), c.reference).status) ?? [];
      return <div className="climate-bar-row" key={r.id}><small>{r.reading_date.slice(5)} {r.period}</small><div className="climate-bar" role="img" aria-label={`${time(r.measured_at)}: ${Object.keys(colors).map(status => `${states.filter(s => s === status).length} ${climateLabels[status as keyof typeof climateLabels]}`).join(', ')}`}>
        {Object.entries(colors).map(([status, color]) => { const n = states.filter(s => s === status).length; return n > 0 ? <span key={status} style={{ width: `${100 * n / states.length}%`, background: color }} title={`${n} ${climateLabels[status as keyof typeof climateLabels]}`}>{n}</span> : null; })}
        {!states.length && <span>Sin criterio histórico</span>}
      </div></div>;
    })}</div><small>Cada barra representa una lectura real; no se asigna estado a las horas sin medición.</small></section>;
}

export default function AgrochemicalClimateModal({ onClose }: { onClose: () => void }) {
  const [dashboard, setDashboard] = useState<ClimateDashboard | null>(null);
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(colombiaDateTime().slice(0, 10));
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [t, setT] = useState(''), [h, setH] = useState('');
  const [measured, setMeasured] = useState(colombiaDateTime());
  const [period, setPeriod] = useState('AM'), [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<ClimateReading | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const busy = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const range = useMemo(() => climateRange(anchor, mode), [anchor, mode]);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus(); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setSelected(null);
    void Promise.resolve(webSupabaseClient().rpc('climate_dashboard', { p_from: range.from, p_to: range.to })).then(({ data, error: problem }) => {
      if (!active) return;
      if (problem) { if (problem.code === '42501') setDashboard(null); setError('No se pudo consultar el control ambiental. Verifica conexión y permisos; los datos anteriores pueden estar desactualizados.'); }
      else { setDashboard(data as ClimateDashboard); setError(''); }
    }).catch(() => { if (active) setError('No se pudo consultar el control ambiental. Intenta actualizar.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to, refreshKey]);
  const criteria = dashboard?.criteria.find(c => c.version === dashboard.current_version);
  const readings = (dashboard?.readings ?? []).filter(r => r.reading_date >= range.from && r.reading_date <= range.to);
  const rule = criteria?.rules.find(r => r.code === code);
  const validPreview = t.trim() !== '' && h.trim() !== '' && Number.isFinite(Number(t)) && Number.isFinite(Number(h)) && Number(t) >= -50 && Number(t) <= 100 && Number(h) >= 0 && Number(h) <= 100;
  const shown = selected ?? readings.at(-1);
  const shownCriteria = shown && dashboard ? criteriaForReading(shown, dashboard) : undefined;
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy.current || !validPreview || !dashboard?.can_record) return;
    const date = new Date(`${measured}:00-05:00`);
    if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) { setError('La fecha y hora deben ser válidas y no estar en el futuro.'); return; }
    const payload = { p_period: period, p_temperature_c: Number(t), p_humidity_percent: Number(h), p_measured_at: date.toISOString(), p_notes: notes.trim() };
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    busy.current = true; setSaving(true); setError(''); setMessage('');
    try {
      const { error: problem } = await webSupabaseClient().rpc('climate_web_record_reading', { p_id: request.current.id, ...payload });
      if (problem) { setError(problem.code === '23505' ? 'Ya existe una medición para esa fecha y turno. Actualiza el historial para consultarla.' : problem.code === '42501' ? 'Tu cuenta no tiene permiso para registrar mediciones.' : 'No se pudo confirmar el guardado. Reintenta con los mismos datos; no se duplicará.'); return; }
      setMessage('Medición guardada en el historial.'); request.current = null; setT(''); setH(''); setNotes(''); setAnchor(measured.slice(0, 10)); setRefreshKey(v => v + 1);
    } catch { setError('No se pudo confirmar el guardado. Reintenta con los mismos datos; no se duplicará.'); }
    finally { busy.current = false; setSaving(false); }
  }
  return <div className="modal-backdrop"><section ref={dialog} tabIndex={-1} className="agro-expiration-modal climate-modal" role="dialog" aria-modal="true" aria-labelledby="climate-title" onKeyDown={event => {
    if (event.key === 'Escape' && !saving) onClose();
    if (event.key === 'Tab') { const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, a[href]'); if (!controls?.length) return; const first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  }}>
    <header className="evidence-header"><div><p className="eyebrow">Agroquímicos · Bodega Azul</p><h2 id="climate-title"><Thermometer size={22} /> Temperatura y humedad</h2><small>Registro, evaluación ambiental e historial · Hora de Colombia</small></div><button type="button" className="icon-button" aria-label="Cerrar" disabled={saving} onClick={onClose}><X size={18} /></button></header>
    <div className="agro-expiration-body climate-body">
      {error && <p role="alert" className="climate-error">{error}</p>}{message && <p role="status">{message}</p>}
      {criteria && <details className="climate-method"><summary>Criterios de evaluación · {criteria.rules.length} productos del PDF</summary><p>La lectura ambiental de Bodega Azul se compara con cada ficha del catálogo suministrado. No demuestra daño ni certifica la calidad del producto; tampoco representa mediciones individuales de cada envase.</p>
        {criteria.reference ? <><p><b>Referencia preventiva interna:</b> {criteria.reference.t_min}–{criteria.reference.t_max} °C y humedad menor al {criteria.reference.h_max} %. Solo completa parámetros sin límite numérico confirmado. Los límites de la ficha tienen prioridad.</p><p>{criteria.reference.note}</p>{criteria.reference.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></p>)}</> : <p>Donde no existe límite numérico confirmado se muestra «Criterio incompleto».</p>}
        <p>Se conservan las advertencias de formulación. Los gráficos no rellenan lecturas faltantes. Una medición por mañana y por tarde.</p></details>}
      {dashboard?.can_record && <form className="climate-form" onSubmit={save}><h3>Nueva medición</h3><fieldset disabled={saving}><div className="climate-fields">
        <label>Temperatura (°C)<input type="number" step="0.1" min="-50" max="100" required value={t} onChange={e => setT(e.target.value)} /></label>
        <label>Humedad relativa (%)<input type="number" step="0.1" min="0" max="100" required value={h} onChange={e => setH(e.target.value)} /></label>
        <label>Fecha y hora (Colombia)<input type="datetime-local" required value={measured} max={colombiaDateTime()} onChange={e => setMeasured(e.target.value)} /></label>
        <label>Turno<select value={period} onChange={e => setPeriod(e.target.value)}><option value="AM">Mañana (AM)</option><option value="PM">Tarde (PM)</option></select></label>
      </div><label>Observaciones<textarea maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Condiciones observadas o acciones realizadas" /></label>
      <button className="climate-primary" type="submit" disabled={!validPreview || !criteria}>{saving ? 'Guardando…' : 'Guardar medición'}</button></fieldset>
      {validPreview && criteria && <section><h3>Evaluación antes de guardar</h3><ProductConditions criteria={criteria} t={Number(t)} h={Number(h)} /></section>}</form>}
      <section><h3>Gráficos e historial</h3><div className="climate-fields">
        <label>Periodo<select value={mode} onChange={e => setMode(e.target.value as 'week' | 'month')}><option value="week">Semana</option><option value="month">Mes</option></select></label>
        <label>Fecha del periodo<input type="date" value={anchor} onChange={e => { if (e.target.value) setAnchor(e.target.value); }} /></label>
        <label>Producto<select value={code} onChange={e => setCode(e.target.value)}><option value="">Todos los productos</option>{criteria?.rules.map(r => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}</select></label>
        <button type="button" disabled={loading} onClick={() => setRefreshKey(v => v + 1)}>Actualizar registros</button>
      </div><p>{range.from} a {range.to} · {readings.length} mediciones. {code ? 'Límites actuales del producto seleccionado.' : 'La temperatura y humedad de la bodega son comunes a todos los productos.'}</p>
      {loading && <p role="status">Consultando mediciones…</p>}
      <div className="climate-charts"><ClimateChart readings={readings} metric="temperature_c" rule={rule} criteria={criteria} {...range} /><ClimateChart readings={readings} metric="humidity_percent" rule={rule} criteria={criteria} {...range} /></div>
      {dashboard && <ProductHistoryChart readings={readings} dashboard={dashboard} code={code} />}
      {!loading && !readings.length && <p>No hay mediciones registradas en este periodo.</p>}
      {readings.length > 0 && <div className="climate-table"><table><caption>Historial de mediciones · Selecciona un registro para ver los productos</caption><thead><tr><th>Fecha / turno</th><th>Temperatura</th><th>Humedad</th><th>{code ? 'Evaluación del producto' : 'Productos fuera de criterio'}</th><th>Responsable / observaciones</th><th>Detalle</th></tr></thead><tbody>{[...readings].reverse().map(r => {
        const c = dashboard ? criteriaForReading(r, dashboard) : undefined;
        const results = c?.rules.filter(item => !code || item.code === code).map(item => evaluateClimate(item, Number(r.temperature_c), Number(r.humidity_percent), c.reference)) ?? [];
        return <tr key={r.id}><td>{time(r.measured_at)} · {r.period}</td><td>{number(r.temperature_c)} °C</td><td>{number(r.humidity_percent)} %</td><td>{code ? results[0] ? climateLabels[results[0].status] : 'Sin criterio histórico' : `${results.filter(a => a.status === 'outside').length} / ${results.length}`}{!r.criteria_version && <small>Evaluación retrospectiva</small>}</td><td>{r.responsible_name}<small>{r.notes}</small></td><td><button type="button" onClick={() => setSelected(r)}>Ver productos</button></td></tr>;
      })}</tbody></table></div>}
      {shown && shownCriteria && <section><h3>{selected ? 'Medición seleccionada' : 'Última medición del periodo'} · {time(shown.measured_at)}</h3><p>{number(shown.temperature_c)} °C · {number(shown.humidity_percent)} % · {shown.criteria_version ? 'Evaluación con los criterios conservados al registrar.' : 'Evaluación retrospectiva con los criterios actuales.'}</p><ProductConditions criteria={shownCriteria} t={Number(shown.temperature_c)} h={Number(shown.humidity_percent)} code={code} /></section>}
      </section>
    </div>
  </section></div>;
}
