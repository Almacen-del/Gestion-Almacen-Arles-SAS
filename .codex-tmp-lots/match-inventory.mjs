import { execFileSync } from 'node:child_process';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const projectId = 'arles-gestion';
const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], { encoding: 'utf8' }).trim();

function firestoreValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, firestoreValue(v)]));
  return null;
}

function decodeDocument(document) {
  return {
    id: document.name.split('/').at(-1),
    ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreValue(value)])),
  };
}

async function listInventory() {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/existencias`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Firestore ${response.status}: ${await response.text()}`);
    const body = await response.json();
    documents.push(...(body.documents || []).map(decodeDocument));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return documents;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return new Set(normalize(value).split(' ').filter((token) => token.length > 1));
}

function levenshtein(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function score(source, candidate) {
  const a = normalize(source);
  const b = normalize(candidate);
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.94;
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const tokenScore = overlap / Math.max(aTokens.size, bTokens.size, 1);
  const editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
  return Math.max(tokenScore, editScore * 0.9);
}

function excelDate(value) {
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}*`;
  }
  return text;
}

const input = await FileBlob.load('C:/Users/Almacen/Desktop/lotes_y_fechas_vencimiento.xlsx');
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem('Vencimientos');
const values = sheet.getUsedRange(true).values;
const rows = values.slice(1).filter((row) => row.some((value) => value !== null && value !== ''));
const inventory = (await listInventory())
  .filter((item) => normalize(item.modulo).includes('AGROQUIMICO'))
  .map((item) => ({
    id: item.id,
    code: item.codigo_original || item.codigoOriginal || item.codigo_excel || item.codigo || item.codigo_interno || '',
    name: item.item || item.producto || item.nombre || item.id,
    stock: Number(item.cantidad ?? item.stock_actual ?? item.stock ?? item.saldo ?? 0),
    unit: item.unidad || '',
    location: item.ubicacion || '',
  }));

const matches = rows.map(([product, lot, expiration]) => {
  const candidates = inventory
    .map((item) => ({ ...item, score: score(product, item.name) }))
    .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code))
    .slice(0, 3);
  return {
    product,
    lot: lot === null ? '' : String(lot),
    expiration: excelDate(expiration),
    candidates,
  };
});

console.log(JSON.stringify({
  inventoryCount: inventory.length,
  rowCount: matches.length,
  matches: matches.map((match) => ({
    product: match.product,
    lot: match.lot,
    expiration: match.expiration,
    top: match.candidates[0],
    second: match.candidates[1] ? {
      id: match.candidates[1].id,
      code: match.candidates[1].code,
      name: match.candidates[1].name,
      score: match.candidates[1].score,
    } : null,
  })),
}, null, 2));
