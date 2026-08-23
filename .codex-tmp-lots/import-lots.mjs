import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const PROJECT_ID = 'arles-gestion';
const DATABASE_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const TODAY = '2026-08-22';
const commit = process.argv.includes('--commit');
const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], { encoding: 'utf8' }).trim();

const codeBySheetName = new Map(Object.entries({
  Carrier: 'VAR034', Engrose: 'FER169', VioSurfn: 'FER065', Induplant: 'FER125', ZincNergia: 'FER142',
  'Smart Calcio': 'FER059', 'Microkel Boro': 'FER058', 'Cosmoquel EDTA-Fe': 'FER130', 'Kelatex-Mg': 'FER156',
  'Cosmoquel EDTA-Ca': 'FER113', 'Cosmoquel EDTA-Mn': 'FER128', 'Cosmoquel EDTA-Zn': 'FER118', 'Molib-K': 'FER029',
  'ProGibb 10 SP': 'VAR045', 'Primordial-PK': 'FER143', Rebrote: 'FER116', N300: 'FER144', 'Fertiquel-Mg': 'FER147',
  Fertiamino: 'FER145', 'Microkel Calcio Boro': 'PENDING_SPLIT', Folcamag: 'FER016', Siliconex: 'U-VAR002',
  'Transfer IONIC': 'VAR028', Luctus: 'FER111', 'Transfer ADHEX': 'VAR036', Microquel: 'PENDING_SPLIT',
  'Zinc Organic': 'U-FER005', 'Nutriquel Menores': 'FER015', 'Smart Zinc': 'FER060', Actiplant: 'FER124',
  Stimplex: 'FER115', 'Tropical Algae': 'FER173', Creciphyl: 'FER140', Fluyex: 'VAR018', FunBacter: 'FUN024',
  Yodosáfer: 'FER151', 'Hawker Plus': 'INS009', 'Karate Zeon': 'INS004', 'Exalt 60 SC': 'INS005', Prevalor: 'FUN023',
  'Amistar Top': 'FUN006', Nativo: 'IGNORE', 'Timorex Gold': 'BIO018', Nemacyl: 'MISSING_LOT', Promalina: 'VAR044',
  'BA.3': 'VAR047', 'Oxiclor 50 WP': 'FUN005', Kumulus: 'FUN016',
}));

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function decodeValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decodeValue(child)]));
  return null;
}

function decodeDocument(document) {
  return {
    id: document.name.split('/').at(-1),
    name: document.name,
    createTime: document.createTime,
    updateTime: document.updateTime,
    fields: Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)])),
  };
}

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeValue(child)])) } };
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`Firestore ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function listInventory() {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/${DATABASE_ROOT}/existencias`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await api(url);
    documents.push(...(body.documents || []).map(decodeDocument));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return documents;
}

async function listLots() {
  const body = await api(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'lotes_agroquimicos', allDescendants: true }] } }),
  });
  return body.flatMap((row) => row.document ? [decodeDocument(row.document)] : []);
}

function expirationValue(value) {
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return { value: date.toISOString().slice(0, 10), precision: 'dia' };
  }
  const text = String(value || '').trim();
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return { value: `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`, precision: 'dia' };
  match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return { value: `${match[2]}-${match[1].padStart(2, '0')}`, precision: 'mes' };
  throw new Error(`Fecha no reconocida: ${text}`);
}

function lotId(lot, expiration) {
  const normalizedLot = normalize(lot).replace(/ /g, '-');
  if (!normalizedLot) throw new Error('Lote vacío.');
  return `${normalizedLot}__${expiration}`;
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load('C:/Users/Almacen/Desktop/lotes_y_fechas_vencimiento.xlsx'));
const rows = workbook.worksheets.getItem('Vencimientos').getUsedRange(true).values.slice(1)
  .filter((row) => row.some((value) => value !== null && value !== ''));
const inventory = (await listInventory()).filter((document) => normalize(document.fields.modulo).includes('AGROQUIMICO'));
const existingLots = await listLots();
const planned = [];
const skipped = [];

for (const [sheetName, rawLot, rawExpiration] of rows) {
  const code = codeBySheetName.get(String(sheetName));
  if (!code) throw new Error(`No hay mapeo revisado para ${sheetName}.`);
  if (['IGNORE', 'MISSING_LOT', 'PENDING_SPLIT'].includes(code)) {
    skipped.push({ product: sheetName, reason: code });
    continue;
  }
  const candidates = inventory.filter((document) => normalize(
    document.fields.codigo_original || document.fields.codigoOriginal || document.fields.codigo_excel
      || document.fields.codigo || document.fields.codigo_interno,
  ) === normalize(code));
  if (candidates.length !== 1) throw new Error(`${sheetName}: se esperaban 1 producto para ${code} y aparecieron ${candidates.length}.`);
  const product = candidates[0];
  const stock = Number(product.fields.cantidad ?? product.fields.stock_actual ?? product.fields.stock ?? product.fields.saldo ?? 0);
  if (!Number.isFinite(stock) || stock <= 0) throw new Error(`${sheetName}: stock actual inválido (${stock}).`);
  if (existingLots.some((existing) => existing.name.includes(`/existencias/${product.id}/lotes_agroquimicos/`))) {
    throw new Error(`${sheetName}: el producto ya tiene lotes registrados; se detuvo para no duplicar cantidades.`);
  }
  const expiration = expirationValue(rawExpiration);
  const number = String(rawLot || '').trim();
  const id = lotId(number, expiration.value);
  planned.push({
    sheetName,
    productId: product.id,
    code,
    productName: product.fields.item || product.fields.producto || product.fields.nombre || product.id,
    stock,
    unit: product.fields.unidad || 'Unidad',
    location: product.fields.ubicacion || '',
    lotNumber: number,
    expiration: expiration.value,
    expirationPrecision: expiration.precision,
    documentName: `${DATABASE_ROOT}/existencias/${product.id}/lotes_agroquimicos/${id}`,
  });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join('C:/Users/Almacen/Desktop/respaldos_gestion', `lotes-agroquimicos-${timestamp}`);
await fs.mkdir(backupDir, { recursive: true });
await fs.writeFile(path.join(backupDir, 'antes.json'), JSON.stringify({ projectId: PROJECT_ID, inventory, existingLots }, null, 2));
await fs.writeFile(path.join(backupDir, 'simulacion.json'), JSON.stringify({ planned, skipped }, null, 2));

if (commit) {
  const writes = planned.map((item) => ({
    update: {
      name: item.documentName,
      fields: encodeFields({
        producto_id: item.productId,
        codigo_producto: item.code,
        producto: item.productName,
        numero_lote: item.lotNumber,
        fecha_vencimiento: item.expiration,
        precision_vencimiento: item.expirationPrecision,
        fecha_ingreso: TODAY,
        fecha_ingreso_estimada: true,
        cantidad_inicial: item.stock,
        cantidad_disponible: item.stock,
        asignaciones_entrada: [],
        unidad: item.unit,
        ubicacion: item.location,
        origen_registro: 'importacion_fisica_excel',
        archivo_origen: 'lotes_y_fechas_vencimiento.xlsx',
        fecha_registro: TODAY,
      }),
    },
    currentDocument: { exists: false },
  }));
  await api(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes }),
  });
}

console.log(JSON.stringify({
  mode: commit ? 'commit' : 'dry-run',
  backupDir,
  existingLotCount: existingLots.length,
  plannedCount: planned.length,
  exactDateCount: planned.filter((item) => item.expirationPrecision === 'dia').length,
  monthOnlyCount: planned.filter((item) => item.expirationPrecision === 'mes').length,
  expiredCount: planned.filter((item) => `${item.expiration}${item.expiration.length === 7 ? '-31' : ''}` < TODAY).length,
  skipped,
}, null, 2));
