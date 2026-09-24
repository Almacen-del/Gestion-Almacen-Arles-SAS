export type ClimateRule = { code: string; name: string; page: number; group: string; temperature_text: string; humidity_text: string; details: string; t_min: number | null; t_max: number | null; h_max: number | null; unconfirmed: boolean };
export type ClimateReference = { t_min: number; t_max: number; h_max: number; note: string; sources: { title: string; url: string }[] };
export type ClimateCriteria = { version: string; source: string; sha256: string; rules: ClimateRule[]; reference: ClimateReference | null };
export type ClimateStatus = 'outside' | 'within' | 'reference' | 'unknown';
export type ClimateReading = { id: string; period: 'AM' | 'PM'; reading_date: string; temperature_c: number; humidity_percent: number; measured_at: string; responsible_name: string; notes: string; criteria_version: string | null };
export type ClimateDashboard = { criteria: ClimateCriteria[]; current_version: string; readings: ClimateReading[]; can_record: boolean };
export const climateLabels: Record<ClimateStatus, string> = { outside: 'Fuera de criterio', within: 'Dentro de límites de la ficha', reference: 'Dentro de referencia orientativa', unknown: 'Criterio incompleto' };
export function evaluateClimate(rule: ClimateRule, t: number, h: number, reference: ClimateReference | null) {
  const reasons: string[] = [];
  if (!Number.isFinite(t) || !Number.isFinite(h)) return { status: 'unknown' as ClimateStatus, reasons: ['Falta una medición válida'] };
  const hasTemperature = rule.t_min !== null || rule.t_max !== null;
  const min = hasTemperature ? rule.t_min : reference?.t_min ?? null;
  const max = hasTemperature ? rule.t_max : reference?.t_max ?? null;
  const humidity = rule.h_max ?? reference?.h_max ?? null;
  if (min !== null && t < min) reasons.push(`Temperatura inferior a ${min} °C${hasTemperature ? '' : ' (referencia)'}`);
  if (max !== null && t > max) reasons.push(`Temperatura superior a ${max} °C${hasTemperature ? '' : ' (referencia)'}`);
  if (humidity !== null && (rule.h_max !== null ? h > humidity : h >= humidity)) reasons.push(`Humedad ${rule.h_max !== null ? 'superior a' : 'igual o superior a'} ${humidity} %${rule.h_max !== null ? '' : ' (referencia)'}`);
  const status: ClimateStatus = reasons.length ? 'outside' : hasTemperature && rule.h_max !== null && !rule.unconfirmed ? 'within' : reference ? 'reference' : 'unknown';
  return { status, reasons };
}
export function colombiaDateTime(now = new Date()) { return new Date(now.getTime() - 5 * 3600000).toISOString().slice(0, 16); }
export function climateRange(anchor: string, mode: 'week' | 'month') {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return climateRange(colombiaDateTime().slice(0, 10), mode);
  if (mode === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  else date.setUTCDate(1);
  const from = date.toISOString().slice(0, 10);
  if (mode === 'week') date.setUTCDate(date.getUTCDate() + 6);
  else { date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0); }
  return { from, to: date.toISOString().slice(0, 10) };
}
export function criteriaForReading(reading: ClimateReading, dashboard: ClimateDashboard) {
  return dashboard.criteria.find(c => c.version === (reading.criteria_version ?? dashboard.current_version));
}
