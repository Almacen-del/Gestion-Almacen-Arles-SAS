import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const PROJECT_ID = 'arles-gestion';
const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const commit = process.argv.includes('--commit');
const targets = [
  {
    id: 'CHhYvsRh7qjFz8Ca6nL8',
    code: 'GAS1',
    module: 'Combustible',
    description: 'Gasolina',
    datePrefix: '2026-06-18',
  },
  {
    id: 'KNDKPYknXQE6itHRfVQ5',
    code: 'GAS1',
    module: 'Combustible',
    description: 'Gasolina',
    datePrefix: '2026-06-16',
  },
  {
    id: 'HetZNwmNDbYeOSoRwMGh',
    code: 'DOT-035',
    module: 'Dotación',
    description: 'BOTA MATERIAL CAÑA ALTA (Talla: 40)',
    datePrefix: '2026-07-10',
  },
];

const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], {
  encoding: 'utf8',
}).trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
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

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

const documents = await Promise.all(targets.map((target) => api(
  `https://firestore.googleapis.com/v1/${ROOT}/movimientos/${target.id}`,
)));

const plan = targets.map((target, index) => {
  const document = documents[index];
  const currentCode = textField(
    document,
    'codigo_interno',
    'codigoInterno',
    'codigo',
    'codigo_interno_origen',
    'codigo_original',
    'producto_id',
    'documento_id',
  );
  const moduleName = textField(document, 'modulo');
  const description = textField(document, 'item', 'producto', 'herramientaNombre');
  const date = textField(document, 'fecha', 'createdAt');
  if (currentCode) throw new Error(`${target.id} ya tiene código o vínculo (${currentCode}); no se sobrescribió.`);
  if (normalize(moduleName) !== normalize(target.module)) throw new Error(`${target.id} cambió de módulo: ${moduleName}.`);
  if (normalize(description) !== normalize(target.description)) throw new Error(`${target.id} cambió de descripción: ${description}.`);
  if (!date.startsWith(target.datePrefix)) throw new Error(`${target.id} cambió de fecha: ${date}.`);
  return {
    id: target.id,
    module: moduleName,
    description,
    date,
    previousCode: null,
    newCode: target.code,
    updateTime: document.updateTime,
  };
});

if (!commit) {
  console.log(JSON.stringify({ mode: 'simulation', writes: 0, plan }, null, 2));
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = `C:/Users/Almacen/Desktop/respaldos_gestion/codigos-movimientos-${timestamp}`;
await fs.mkdir(backupDirectory, { recursive: true });
const backupPath = `${backupDirectory}/antes.json`;
await fs.writeFile(backupPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  documents,
}, null, 2));

const writes = plan.map((entry) => ({
  update: {
    name: `${ROOT}/movimientos/${entry.id}`,
    fields: { codigo_interno: { stringValue: entry.newCode } },
  },
  updateMask: { fieldPaths: ['codigo_interno'] },
  currentDocument: { updateTime: entry.updateTime },
}));
await api(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`, {
  method: 'POST',
  body: JSON.stringify({ writes }),
});

const verified = await Promise.all(targets.map(async (target) => {
  const document = await api(`https://firestore.googleapis.com/v1/${ROOT}/movimientos/${target.id}`);
  const code = textField(document, 'codigo_interno');
  if (code !== target.code) throw new Error(`Verificación fallida para ${target.id}: ${code}.`);
  return { id: target.id, code };
}));

console.log(JSON.stringify({ mode: 'commit', writes: verified.length, backupPath, verified }, null, 2));
