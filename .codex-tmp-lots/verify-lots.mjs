import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const projectId = 'arles-gestion';
const backupDir = 'C:/Users/Almacen/Desktop/respaldos_gestion/lotes-agroquimicos-2026-08-22T17-05-25-330Z';
const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], { encoding: 'utf8' }).trim();

function value(input = {}) {
  if ('stringValue' in input) return input.stringValue;
  if ('integerValue' in input) return Number(input.integerValue);
  if ('doubleValue' in input) return Number(input.doubleValue);
  if ('booleanValue' in input) return input.booleanValue;
  return null;
}

const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'lotes_agroquimicos', allDescendants: true }] } }),
});
if (!response.ok) throw new Error(await response.text());
const remote = (await response.json()).flatMap((row) => row.document ? [{
  name: row.document.name,
  fields: Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, field]) => [key, value(field)])),
}] : []);
const simulation = JSON.parse(await fs.readFile(`${backupDir}/simulacion.json`, 'utf8'));
const byName = new Map(remote.map((document) => [document.name, document]));
const mismatches = simulation.planned.flatMap((planned) => {
  const found = byName.get(planned.documentName);
  if (!found) return [`Falta ${planned.sheetName}`];
  const errors = [];
  if (found.fields.producto_id !== planned.productId) errors.push('producto');
  if (found.fields.numero_lote !== planned.lotNumber) errors.push('lote');
  if (found.fields.fecha_vencimiento !== planned.expiration) errors.push('vencimiento');
  if (Math.abs(Number(found.fields.cantidad_disponible) - planned.stock) > 1e-7) errors.push('cantidad');
  return errors.length ? [`${planned.sheetName}: ${errors.join(', ')}`] : [];
});
console.log(JSON.stringify({
  remoteCount: remote.length,
  verifiedCount: simulation.planned.length - mismatches.length,
  mismatches,
  monthOnlyCount: remote.filter((document) => /^\d{4}-\d{2}$/.test(document.fields.fecha_vencimiento)).length,
  expired: remote.filter((document) => {
    const raw = document.fields.fecha_vencimiento || '';
    const comparable = raw.length === 7 ? `${raw}-31` : raw;
    return comparable < '2026-08-22';
  }).map((document) => document.fields.producto),
  oxicron: remote.find((document) => document.fields.codigo_producto === 'FUN005')?.fields || null,
}, null, 2));
