import JSZip from 'jszip';
import { climateRange, colombiaDateTime, type ClimateReading } from '../backend/supabase/climate';

export const CLIMATE_TEMPLATE_URL = '/templates/MP-F-010-temperatura-humedad.xlsx';
const escapeXml = (v: string) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Patch only the official form's cells. Preserve its drawings, merges and print setup.
export async function fillClimateTemplate(template: Uint8Array, month: string, readings: readonly ClimateReading[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecciona un mes válido.');
  const range = climateRange(`${month}-01`, 'month');
  const rows = readings.filter(r => r.reading_date >= range.from && r.reading_date <= range.to);
  if (!rows.length) throw new Error('No hay mediciones registradas en el mes seleccionado.');
  const zip = await JSZip.loadAsync(template);
  const part = zip.file('xl/worksheets/sheet1.xml');
  if (!part) throw new Error('No se pudo leer la plantilla MP-F-010.');
  let sheet = await part.async('string');
  let styles = await zip.file('xl/styles.xml')!.async('string');
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  if (!xfs) throw new Error('La plantilla no contiene estilos válidos.');
  const formats = xfs[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)!;
  const timeStyle = formats.length;
  const timeFormat = formats[3].replace(/numFmtId="\d+"/, 'numFmtId="20"').replace('<xf ', '<xf applyNumberFormat="1" ');
  styles = styles.replace(xfs[0], `<cellXfs count="${formats.length + 1}">${xfs[1]}${timeFormat}</cellXfs>`);
  const set = (address: string, value: string | number | null, style?: number) => {
    const pattern = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    if (!pattern.test(sheet)) throw new Error(`La plantilla no contiene ${address}.`);
    sheet = sheet.replace(pattern, (_all, attrs: string) => {
      attrs = attrs.replace(/\s+t="[^"]*"/g, '').replace(/\/$/, '');
      if (style !== undefined) attrs = attrs.replace(/\s+s="[^"]*"/, '') + ` s="${style}"`;
      if (value === null) return `<c${attrs}/>`;
      if (typeof value === 'number') return `<c${attrs}><v>${value}</v></c>`;
      if (value.length > 32767) throw new Error('Una observación excede el límite de Excel.');
      return `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    });
  };
  set('D4', 'Área de monitoreo: Bodega Azul');
  set('G4', `Mes: ${new Date(`${month}-15T12:00:00Z`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`);
  const days = Number(range.to.slice(8));
  const used = new Set<string>();
  for (const r of rows) {
    const key = `${r.reading_date}/${r.period}`;
    const local = colombiaDateTime(new Date(r.measured_at));
    if (used.has(key) || !['AM', 'PM'].includes(r.period) || local.slice(0, 10) !== r.reading_date || !Number.isFinite(Number(r.temperature_c)) || !Number.isFinite(Number(r.humidity_percent))) throw new Error('Hay mediciones duplicadas o inválidas; revisa el historial antes de exportar.');
    used.add(key);
  }
  for (let day = 1; day <= 31; day++) {
    const row = day + 5;
    const daily = rows.filter(r => r.reading_date === `${month}-${String(day).padStart(2, '0')}`).sort((a, b) => a.period.localeCompare(b.period));
    set(`A${row}`, day <= days ? day : null);
    for (const c of ['B','C','D','E','F','G','H','I']) set(`${c}${row}`, null);
    for (const r of daily) {
      const clock = colombiaDateTime(new Date(r.measured_at)).slice(11).split(':').map(Number);
      const [hour, t, h] = r.period === 'AM' ? ['B','C','D'] : ['E','F','G'];
      set(`${hour}${row}`, (clock[0] * 60 + clock[1]) / 1440, timeStyle);
      set(`${t}${row}`, Number(r.temperature_c)); set(`${h}${row}`, Number(r.humidity_percent));
    }
    if (daily.length) {
      const notes = daily.filter(r => r.notes).map(r => `${r.period}: ${r.notes}`).join('\n');
      const names = daily.map(r => `${r.period}: ${r.responsible_name || ''}`).join('\n');
      set(`H${row}`, notes); set(`I${row}`, names);
      const lines = (s: string) => s.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 16)), 0);
      const height = Math.min(409, Math.max(23.1, Math.max(lines(notes), lines(names)) * 12));
      sheet = sheet.replace(new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*\\bht=")[^"]*"`), `$1${height}"`);
    }
  }
  sheet = sheet.replace('topLeftCell="A15"', 'topLeftCell="A1"');
  zip.file('xl/worksheets/sheet1.xml', sheet); zip.file('xl/styles.xml', styles);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function downloadClimateMonth(month: string, readings: readonly ClimateReading[]) {
  const response = await fetch(CLIMATE_TEMPLATE_URL);
  if (!response.ok) throw new Error('No se pudo descargar la plantilla MP-F-010.');
  const bytes = await fillClimateTemplate(new Uint8Array(await response.arrayBuffer()), month, readings);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a'); link.href = url; link.download = `MP-F-010_Bodega_Azul_${month}.xlsx`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
