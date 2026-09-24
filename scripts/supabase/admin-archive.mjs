import {createHash} from 'node:crypto';

const ROOT = 'projects/arles-gestion/databases/(default)/documents/';
const ROOT_COLLECTIONS = new Set(['usuarios', 'valoraciones_inventario', 'valoraciones_entradas', 'cierres_valoracion_inventario']);
export const sha256 = text => createHash('sha256').update(text).digest('hex');

// Preserve the typed Firestore document, including timestamps and original UIDs.
// Frozen close movements are administrative records, never live stock events.
export function isAdministrativePath(path) {
  const parts = path.split('/');
  return (parts.length === 2 && ROOT_COLLECTIONS.has(parts[0])) ||
    (parts.length === 4 && parts[0] === 'cierres_valoracion_inventario' &&
      ['items', 'movimientos', 'recuperaciones'].includes(parts[2]));
}

export function prepareAdminArchive(source, sourceText) {
  if (source.project !== 'arles-gestion' || !Number.isFinite(Date.parse(source.readTime)) || !Array.isArray(source.documents))
    throw new Error('Fuente o fecha de lectura no válida.');
  const seen = new Set();
  const records = [];
  for (const document of source.documents) {
    if (!document.name?.startsWith(ROOT)) throw new Error('Documento de otro proyecto.');
    const path = document.name.slice(ROOT.length);
    if (seen.has(path)) throw new Error(`Documento duplicado: ${path}`);
    seen.add(path);
    if (!isAdministrativePath(path)) continue;
    const raw = JSON.stringify(document);
    if (!document.fields || typeof document.fields !== 'object') throw new Error(`Documento sin campos: ${path}`);
    records.push({path, raw, sha256: sha256(raw)});
  }
  records.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!records.length) throw new Error('No se encontraron datos administrativos.');
  const counts = {};
  for (const row of records) {
    const parts = row.path.split('/');
    const group = parts.length === 4 ? `${parts[0]}/${parts[2]}` : parts[0];
    counts[group] = (counts[group] ?? 0) + 1;
    if (parts.length === 4 && !seen.has(parts.slice(0,2).join('/')))
      throw new Error(`Detalle sin cierre: ${row.path}`);
  }
  return {sourceHash:sha256(sourceText), readTime:source.readTime, counts, records,
    archiveHash:sha256(records.map(row => `${row.path}\t${row.sha256}\n`).join(''))};
}

export function sqlString(text) { return `'${text.replaceAll("'", "''")}'`; }

export function archiveSqlBatches(plan, maxBytes = 70000) {
  const chunks = [];
  let chunk = [];
  let bytes = 0;
  for (const row of plan.records) {
    const line = `(${sqlString(plan.sourceHash)},${sqlString(row.path)},${sqlString(row.raw)},${sqlString(row.sha256)})`;
    const size = Buffer.byteLength(line, 'utf8');
    if (size > maxBytes) throw new Error(`Documento excede tamaño de lote: ${row.path}`);
    if (bytes + size > maxBytes && chunk.length) {chunks.push(chunk);chunk=[];bytes=0;}
    chunk.push(line);bytes += size + 2;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks.map(lines => `begin;\ninsert into public.web_admin_archive(source_hash,path,raw_document,document_sha256) values\n${lines.join(',\n')}\non conflict(source_hash,path) do nothing;\ncommit;\n`);
}
