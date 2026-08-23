import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const PROJECT_ID = 'arles-gestion';
const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const ID = 'XVmgIZ6VHaTDRiwwVrf4';
const commit = process.argv.includes('--commit');
const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], {
  encoding: 'utf8',
}).trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const url = `https://firestore.googleapis.com/v1/${ROOT}/movimientos/${ID}`;

async function readDocument(allowMissing = false) {
  const response = await fetch(url, { headers });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore ${response.status}: ${await response.text()}`);
  return response.json();
}

function textField(document, ...keys) {
  for (const key of keys) {
    const value = document.fields?.[key];
    if (value?.stringValue) return value.stringValue.trim();
  }
  return '';
}

const document = await readDocument();
const code = textField(document, 'codigo_original', 'codigo', 'codigo_interno');
const product = textField(document, 'item', 'producto');
const moduleName = textField(document, 'modulo');
const movementType = textField(document, 'tipoMovimiento', 'tipo', 'movimiento');
const date = textField(document, 'fecha', 'createdAt');
if (code !== 'TSTAGRO711' || product !== 'PRODUCTO_PRUEBA_CODEX_20260711') {
  throw new Error(`El documento ya no coincide con la prueba esperada: ${code} · ${product}.`);
}

const plan = { id: ID, code, product, module: moduleName, type: movementType, date };
if (!commit) {
  console.log(JSON.stringify({ mode: 'simulation', deletes: 0, plan }, null, 2));
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = `C:/Users/Almacen/Desktop/respaldos_gestion/tstagro711-prueba-eliminada-${timestamp}`;
await fs.mkdir(backupDirectory, { recursive: true });
const backupPath = `${backupDirectory}/antes.json`;
await fs.writeFile(backupPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  reason: 'Movimiento de producto de prueba confirmado por el usuario',
  document,
}, null, 2));

const response = await fetch(
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
  {
    method: 'POST',
    headers,
    body: JSON.stringify({
      writes: [{
        delete: `${ROOT}/movimientos/${ID}`,
        currentDocument: { updateTime: document.updateTime },
      }],
    }),
  },
);
if (!response.ok) throw new Error(`No se pudo eliminar la prueba: ${await response.text()}`);
if (await readDocument(true)) throw new Error('El documento todavía existe después del commit.');

console.log(JSON.stringify({ mode: 'commit', deletes: 1, deleted: plan, backupPath }, null, 2));
