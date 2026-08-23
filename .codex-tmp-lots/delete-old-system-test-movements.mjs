import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const PROJECT_ID = 'arles-gestion';
const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const commit = process.argv.includes('--commit');
const targetIds = [
  '1vOpQbwYTF8rtsa0AFab',
  'ctopxdCdjikjVf9BRbAR',
  'NfVJVvCiwH2GAY86ZvqN',
  'm72ZPhZk2dRUXVjgIpiO',
];

const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], {
  encoding: 'utf8',
}).trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function getDocument(id, allowMissing = false) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/${ROOT}/movimientos/${id}`,
    { headers },
  );
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

const documents = await Promise.all(targetIds.map((id) => getDocument(id)));
const plan = documents.map((document, index) => {
  const id = targetIds[index];
  const moduleName = textField(document, 'modulo');
  const description = textField(document, 'item', 'producto', 'herramientaNombre');
  const code = textField(
    document,
    'codigo_interno',
    'codigoInterno',
    'codigo',
    'codigo_original',
    'producto_id',
    'documento_id',
  );
  if (code || description) {
    throw new Error(`${id} ahora contiene producto o código; no se eliminó.`);
  }
  if (id !== '1vOpQbwYTF8rtsa0AFab' && moduleName.toLowerCase() !== 'sistema') {
    throw new Error(`${id} ya no pertenece al módulo Sistema; no se eliminó.`);
  }
  return {
    id,
    module: moduleName || 'Sin módulo',
    date: textField(document, 'fecha', 'createdAt') || 'Sin fecha',
    updateTime: document.updateTime,
  };
});

if (!commit) {
  console.log(JSON.stringify({ mode: 'simulation', deletes: 0, plan }, null, 2));
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = `C:/Users/Almacen/Desktop/respaldos_gestion/movimientos-prueba-eliminados-${timestamp}`;
await fs.mkdir(backupDirectory, { recursive: true });
const backupPath = `${backupDirectory}/antes.json`;
await fs.writeFile(backupPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  reason: 'Pruebas antiguas confirmadas por el usuario',
  documents,
}, null, 2));

const response = await fetch(
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
  {
    method: 'POST',
    headers,
    body: JSON.stringify({
      writes: plan.map((entry) => ({
        delete: `${ROOT}/movimientos/${entry.id}`,
        currentDocument: { updateTime: entry.updateTime },
      })),
    }),
  },
);
if (!response.ok) throw new Error(`No se pudo confirmar la eliminación: ${await response.text()}`);

const verification = await Promise.all(targetIds.map(async (id) => ({
  id,
  deleted: (await getDocument(id, true)) === null,
})));
if (verification.some((entry) => !entry.deleted)) {
  throw new Error('La verificación encontró al menos un documento todavía existente.');
}

console.log(JSON.stringify({
  mode: 'commit',
  deletes: verification.length,
  backupPath,
  verification,
}, null, 2));
