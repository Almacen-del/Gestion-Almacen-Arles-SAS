import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const PROJECT_ID = 'arles-gestion';
const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const commit = process.argv.includes('--commit');
const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], {
  encoding: 'utf8',
}).trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(url, options = {}, allowMissing = false) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

function textField(document, ...keys) {
  for (const key of keys) {
    const value = document.fields?.[key];
    if (value?.stringValue) return value.stringValue.trim();
  }
  return '';
}

function numberField(document, ...keys) {
  for (const key of keys) {
    const value = document.fields?.[key];
    if (value?.integerValue !== undefined) return Number(value.integerValue);
    if (value?.doubleValue !== undefined) return Number(value.doubleValue);
    if (value?.stringValue?.trim()) {
      const parsed = Number(value.stringValue.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function documentId(document) {
  return document.name.split('/').at(-1);
}

async function listInventory() {
  const documents = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/${ROOT}/existencias`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await api(url);
    documents.push(...(body.documents || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return documents;
}

async function queryMovementReferences(fieldPath, id) {
  const rows = await api(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'movimientos' }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: id } } },
        limit: 2,
      },
    }),
  });
  return rows.flatMap((row) => row.document ? [row.document.name.split('/').at(-1)] : []);
}

const inventory = await listInventory();
const matches = inventory.filter((document) => (
  textField(document, 'codigo_original', 'codigoOriginal', 'codigo_excel', 'codigo', 'codigo_interno', 'codigoInterno')
    .toUpperCase() === 'ENM020'
));
const summarized = matches.map((document) => ({
  id: documentId(document),
  code: 'ENM020',
  product: textField(document, 'item', 'producto', 'nombre'),
  location: textField(document, 'ubicacion') || 'Sin ubicación',
  stock: numberField(document, 'cantidad', 'stock_actual', 'stock', 'saldo'),
  updateTime: document.updateTime,
}));
const zeroMatches = summarized.filter((entry) => entry.stock === 0);
const positiveMatches = summarized.filter((entry) => entry.stock > 0);
if (zeroMatches.length !== 1 || positiveMatches.length < 1) {
  throw new Error(`Precondición incumplida para ENM020: ${JSON.stringify(summarized)}.`);
}
const targetSummary = zeroMatches[0];
const targetDocument = matches.find((document) => documentId(document) === targetSummary.id);

const lotList = await api(
  `https://firestore.googleapis.com/v1/${ROOT}/existencias/${targetSummary.id}/lotes_agroquimicos?pageSize=1`,
);
if ((lotList.documents || []).length > 0) {
  throw new Error(`El registro ${targetSummary.id} tiene lotes vinculados; no se eliminó.`);
}
const movementReferences = [
  ...(await queryMovementReferences('producto_id', targetSummary.id)),
  ...(await queryMovementReferences('documento_id', targetSummary.id)),
];
if (movementReferences.length > 0) {
  throw new Error(`El registro ${targetSummary.id} tiene movimientos vinculados: ${movementReferences.join(', ')}.`);
}

const plan = {
  target: targetSummary,
  preserved: positiveMatches,
  lots: 0,
  directMovementReferences: 0,
};
if (!commit) {
  console.log(JSON.stringify({ mode: 'simulation', deletes: 0, plan }, null, 2));
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = `C:/Users/Almacen/Desktop/respaldos_gestion/enm020-cero-eliminado-${timestamp}`;
await fs.mkdir(backupDirectory, { recursive: true });
const backupPath = `${backupDirectory}/antes.json`;
await fs.writeFile(backupPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  reason: 'Registro duplicado ENM020 con disponible cero confirmado por el usuario',
  target: targetDocument,
  preserved: positiveMatches,
}, null, 2));

await api(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, {
  method: 'POST',
  body: JSON.stringify({
    writes: [{
      delete: `${ROOT}/existencias/${targetSummary.id}`,
      currentDocument: { updateTime: targetSummary.updateTime },
    }],
  }),
});

const deleted = await api(
  `https://firestore.googleapis.com/v1/${ROOT}/existencias/${targetSummary.id}`,
  {},
  true,
) === null;
if (!deleted) throw new Error(`El registro ${targetSummary.id} todavía existe después del commit.`);
const currentInventory = await listInventory();
const remaining = currentInventory.filter((document) => (
  textField(document, 'codigo_original', 'codigoOriginal', 'codigo_excel', 'codigo', 'codigo_interno', 'codigoInterno')
    .toUpperCase() === 'ENM020'
)).map((document) => ({
  id: documentId(document),
  stock: numberField(document, 'cantidad', 'stock_actual', 'stock', 'saldo'),
}));
if (remaining.length < 1 || remaining.some((entry) => entry.stock <= 0)) {
  throw new Error(`Verificación final inesperada: ${JSON.stringify(remaining)}.`);
}

console.log(JSON.stringify({
  mode: 'commit',
  deletes: 1,
  deleted: targetSummary,
  remaining,
  backupPath,
}, null, 2));
