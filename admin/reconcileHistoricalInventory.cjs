const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const minimist = require('minimist');

const FIREBASE_TOOLS_ROOT = path.join(
  process.env.APPDATA || '',
  'npm',
  'node_modules',
  'firebase-tools',
);

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeAseoCode(value) {
  const original = String(value ?? '').trim().toUpperCase();
  const compact = original.replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/^H(\d{2})(\d{3})$/);
  return match ? `H${match[1]}-${match[2]}` : original;
}

function stringValue(data, ...keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numberValue(data, ...keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

async function listCollectionDocuments({ projectId, collectionId, accessToken }) {
  const documents = [];
  let pageToken = '';
  do {
    const endpoint = new URL(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(collectionId)}`,
    );
    endpoint.searchParams.set('pageSize', '1000');
    endpoint.searchParams.set('showMissing', 'false');
    if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Firestore devolvió HTTP ${response.status} al leer ${collectionId}.`);
    }
    const payload = await response.json();
    for (const document of payload.documents || []) {
      documents.push({
        id: decodeURIComponent(document.name.split('/').at(-1)),
        name: document.name,
        createTime: document.createTime || null,
        updateTime: document.updateTime || null,
        data: decodeFirestoreFields(document.fields || {}),
      });
    }
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return documents;
}

function normalizeActiveAseo(document) {
  const data = document.data;
  return {
    source: 'productos_aseo',
    id: document.id,
    module: 'ASEO',
    code: normalizeAseoCode(stringValue(data, 'codigo_interno', 'codigoInterno', 'codigo')),
    name: stringValue(data, 'producto', 'item', 'nombre') || document.id,
    reference: stringValue(data, 'piso'),
    category: stringValue(data, 'categoria'),
    unit: stringValue(data, 'unidad'),
    stock: numberValue(data, 'stock_actual'),
    updateTime: document.updateTime,
  };
}

function normalizeExistence(document) {
  const data = document.data;
  const module = stringValue(data, 'modulo', 'module') || 'Sin módulo';
  const normalizedModule = normalizeText(module);
  const isAseo = normalizedModule === 'ASEO' || normalizedModule === 'ASEO HISTORICO';
  return {
    source: 'existencias',
    id: document.id,
    module,
    normalizedModule,
    code: isAseo
      ? normalizeAseoCode(stringValue(data, 'codigo_interno', 'codigoInterno', 'codigo'))
      : stringValue(data, 'codigo_interno', 'codigoInterno', 'codigo', 'codigo_principal', 'codigo_qr'),
    name: stringValue(data, 'item', 'producto', 'nombre') || document.id,
    reference: stringValue(data, 'referencia', 'ref', 'talla', 'piso'),
    category: stringValue(data, 'categoria'),
    unit: stringValue(data, 'unidad'),
    stock: numberValue(data, 'cantidad', 'stock_actual', 'stock', 'saldo'),
    updateTime: document.updateTime,
  };
}

function normalizeMovement(document) {
  const data = document.data;
  const module = stringValue(data, 'modulo', 'module') || 'Sin módulo';
  return {
    id: document.id,
    module,
    normalizedModule: normalizeText(module),
    productDocumentId: stringValue(data, 'producto_id', 'documento_id', 'herramientaId', 'herramienta_clave'),
    code: stringValue(
      data,
      'codigo_interno',
      'codigoInterno',
      'codigo',
      'codigo_interno_origen',
      'codigo_original',
    ),
    name: stringValue(data, 'item', 'producto', 'herramientaNombre', 'nombre'),
    reference: stringValue(data, 'referencia', 'ref', 'talla', 'piso'),
    unit: stringValue(data, 'unidad'),
    occurredAt: stringValue(data, 'fecha', 'createdAt'),
    stockBefore: numberValue(data, 'stock_anterior'),
    stockAfter: numberValue(data, 'stock_nuevo'),
  };
}

function movementFamily(module) {
  const normalized = normalizeText(module);
  if (normalized.startsWith('ASEO')) return 'ASEO';
  if (normalized.startsWith('CONSUMIBLES')) return 'CONSUMIBLES';
  return normalized;
}

function canonicalMovementCode(module, code) {
  return movementFamily(module) === 'ASEO' ? normalizeAseoCode(code) : normalizeText(code);
}

function movementMatchMethod(movement, row) {
  if (movementFamily(movement.module) !== movementFamily(row.activeModule || row.historicalModule)) return '';
  const documentIds = [row.historicalId, row.activeId].filter(Boolean);
  if (movement.productDocumentId && documentIds.includes(movement.productDocumentId)) return 'document-id';
  const movementCode = canonicalMovementCode(movement.module, movement.code);
  const rowModule = row.activeModule || row.historicalModule;
  const codes = [row.historicalCode, row.activeCode]
    .map((code) => canonicalMovementCode(rowModule, code))
    .filter(Boolean);
  if (movementCode && codes.includes(movementCode)) return 'code';
  if (
    normalizeText(movement.name)
    && normalizeText(movement.name) === normalizeText(row.historicalName)
    && normalizeText(movement.reference) === normalizeText(row.historicalReference)
  ) return 'name-reference';
  return '';
}

function attachMovementEvidence(rows, movementDocuments) {
  const movements = movementDocuments.map(normalizeMovement);
  const evidence = [];
  const enrichedRows = rows.map((row) => {
    const matches = movements
      .map((movement) => ({ movement, matchMethod: movementMatchMethod(movement, row) }))
      .filter((entry) => entry.matchMethod)
      .sort((left, right) => right.movement.occurredAt.localeCompare(left.movement.occurredAt));
    matches.forEach(({ movement, matchMethod }) => evidence.push({
      historicalId: row.historicalId,
      movementId: movement.id,
      movementModule: movement.module,
      movementCode: movement.code,
      occurredAt: movement.occurredAt,
      stockBefore: movement.stockBefore,
      stockAfter: movement.stockAfter,
      matchMethod,
    }));
    const latest = matches[0];
    let evidenceResult = matches.length > 0 ? 'movement-found-no-current-stock-anchor' : 'no-linked-movements';
    if (latest && latest.movement.stockAfter !== null) {
      if (row.activeStock !== null && Math.abs(latest.movement.stockAfter - row.activeStock) < 1e-7) {
        evidenceResult = 'latest-movement-supports-active-stock';
      } else if (row.historicalStock !== null && Math.abs(latest.movement.stockAfter - row.historicalStock) < 1e-7) {
        evidenceResult = 'latest-movement-supports-historical-stock';
      } else {
        evidenceResult = 'latest-movement-conflicts-with-recorded-stocks';
      }
    }
    return {
      ...row,
      matchedMovementCount: matches.length,
      latestMovementDate: latest?.movement.occurredAt || '',
      latestMovementId: latest?.movement.id || '',
      latestMovementCode: latest?.movement.code || '',
      latestStockBefore: latest?.movement.stockBefore ?? '',
      latestStockAfter: latest?.movement.stockAfter ?? '',
      movementEvidenceResult: evidenceResult,
    };
  });
  return { rows: enrichedRows, evidence };
}

function addLookup(map, key, item) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(item);
  map.set(key, values);
}

function codeKey(item) {
  const targetModule = item.normalizedModule?.startsWith('ASEO') || normalizeText(item.module) === 'ASEO'
    ? 'ASEO'
    : 'CONSUMIBLES';
  return item.code ? `${targetModule}|${normalizeText(item.code)}` : '';
}

function descriptionKey(item) {
  const targetModule = item.normalizedModule?.startsWith('ASEO') || normalizeText(item.module) === 'ASEO'
    ? 'ASEO'
    : 'CONSUMIBLES';
  const name = normalizeText(item.name);
  if (!name) return '';
  return `${targetModule}|${name}|${normalizeText(item.reference)}|${normalizeText(item.unit)}`;
}

function stockComparison(historicalStock, activeStock) {
  if (historicalStock === null || activeStock === null) return 'stock-missing';
  return Math.abs(historicalStock - activeStock) < 1e-7 ? 'same-stock' : 'different-stock';
}

function reconcileHistoricalInventory({ existencias, productosAseo, movimientos = [] }) {
  const normalizedExistencias = existencias.map(normalizeExistence);
  const activeAseo = productosAseo.map(normalizeActiveAseo);
  const activeConsumables = normalizedExistencias.filter((item) => item.normalizedModule === 'CONSUMIBLES');
  const historical = normalizedExistencias.filter((item) => (
    item.normalizedModule === 'ASEO'
    || item.normalizedModule === 'ASEO HISTORICO'
    || item.normalizedModule === 'CONSUMIBLES HISTORICO'
  ));
  const active = [...activeAseo, ...activeConsumables];
  const byCode = new Map();
  const byDescription = new Map();
  active.forEach((item) => {
    addLookup(byCode, codeKey(item), item);
    addLookup(byDescription, descriptionKey(item), item);
  });

  const detectedRows = historical.map((item) => {
    const codeMatches = byCode.get(codeKey(item)) || [];
    const descriptionMatches = byDescription.get(descriptionKey(item)) || [];
    let matches = codeMatches;
    let matchMethod = 'code';
    if (matches.length === 0) {
      matches = descriptionMatches;
      matchMethod = 'name-reference-unit';
    }
    if (matches.length === 1) {
      const match = matches[0];
      return {
        historicalSource: item.source,
        historicalId: item.id,
        historicalModule: item.module,
        historicalCode: item.code,
        historicalName: item.name,
        historicalReference: item.reference,
        historicalUnit: item.unit,
        historicalStock: item.stock,
        historicalUpdateTime: item.updateTime,
        activeSource: match.source,
        activeId: match.id,
        activeModule: match.module,
        activeCode: match.code,
        activeName: match.name,
        activeStock: match.stock,
        activeUpdateTime: match.updateTime,
        matchMethod,
        status: stockComparison(item.stock, match.stock),
        proposedAction: 'link-history-to-active-do-not-sum',
      };
    }
    if (matches.length > 1) {
      return {
        historicalSource: item.source,
        historicalId: item.id,
        historicalModule: item.module,
        historicalCode: item.code,
        historicalName: item.name,
        historicalReference: item.reference,
        historicalUnit: item.unit,
        historicalStock: item.stock,
        historicalUpdateTime: item.updateTime,
        activeSource: '',
        activeId: matches.map((match) => match.id).join(' | '),
        activeModule: '',
        activeCode: matches.map((match) => match.code).join(' | '),
        activeName: matches.map((match) => match.name).join(' | '),
        activeStock: null,
        activeUpdateTime: null,
        matchMethod,
        status: 'ambiguous-active-match',
        proposedAction: 'manual-review',
      };
    }
    return {
      historicalSource: item.source,
      historicalId: item.id,
      historicalModule: item.module,
      historicalCode: item.code,
      historicalName: item.name,
      historicalReference: item.reference,
      historicalUnit: item.unit,
      historicalStock: item.stock,
      historicalUpdateTime: item.updateTime,
      activeSource: '',
      activeId: '',
      activeModule: item.normalizedModule.startsWith('ASEO') ? 'ASEO' : 'Consumibles',
      activeCode: '',
      activeName: '',
      activeStock: null,
      activeUpdateTime: null,
      matchMethod: 'none',
      status: item.code ? 'historical-only' : 'historical-missing-code',
      proposedAction: item.code ? 'promote-after-physical-count' : 'assign-code-and-review',
    };
  });

  const reviewRows = detectedRows.map((row) => ({
    ...row,
    physicalCount: '',
    physicalCountDate: '',
    verifiedBy: '',
    approvedAction: '',
    evidenceReference: '',
  }));
  const { rows, evidence: movementEvidence } = attachMovementEvidence(reviewRows, movimientos);
  const statusCounts = rows.reduce((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1;
    return result;
  }, {});
  const nonTallerCurrentExistencias = normalizedExistencias.filter((item) => (
    item.normalizedModule !== 'TALLER'
    && item.normalizedModule !== 'ASEO'
    && item.normalizedModule !== 'ASEO HISTORICO'
    && item.normalizedModule !== 'CONSUMIBLES HISTORICO'
  ));
  const promotable = rows.filter((row) => row.status === 'historical-only').length;
  const pending = rows.filter((row) => (
    row.status === 'historical-missing-code'
    || row.status === 'ambiguous-active-match'
    || row.status === 'different-stock'
    || row.status === 'stock-missing'
  )).length;
  const activeCountBeforePromotion = nonTallerCurrentExistencias.length + activeAseo.length;

  return {
    rows,
    movementEvidence,
    summary: {
      sourceCounts: {
        existencias: existencias.length,
        productosAseo: productosAseo.length,
        historicalCandidates: historical.length,
        activeAseo: activeAseo.length,
        activeConsumables: activeConsumables.length,
        movements: movimientos.length,
        linkedMovementEvidence: movementEvidence.length,
      },
      statusCounts,
      scope: {
        excludedModule: 'TALLER',
        activeCountBeforePromotion,
        promotableHistoricalOnly: promotable,
        pendingManualReview: pending,
        expectedCountAfterApprovedPromotions: activeCountBeforePromotion + promotable,
      },
    },
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\r\n');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function buildReviewMarkdown(summary, rows) {
  const counts = Object.entries(summary.statusCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join('\n');
  const conflicts = rows
    .filter((row) => row.status === 'different-stock' || row.status === 'stock-missing')
    .map((row) => (
      `| ${row.historicalCode || row.historicalId} | ${row.historicalName} | ${row.historicalStock ?? 'N/A'} | `
      + `${row.activeCode || row.activeId} | ${row.activeStock ?? 'N/A'} | ${row.matchMethod} |`
    ))
    .join('\n');
  const conflictSection = conflicts
    ? `## Coincidencias que requieren decisión\n\n`
      + `| Histórico | Producto | Saldo histórico | Activo | Saldo activo | Coincidencia |\n`
      + `|---|---|---:|---|---:|---|\n${conflicts}\n\n`
    : '';
  return `# Conciliación de inventario histórico — simulación\n\n`
    + `Este informe se generó en modo de solo lectura. No se modificó Firestore.\n\n`
    + `## Alcance\n\n`
    + `- Único módulo excluido del inventario objetivo: \`${summary.scope.excludedModule}\`.\n`
    + `- Registros activos antes de promociones: ${summary.scope.activeCountBeforePromotion}.\n`
    + `- Históricos promovibles tras conteo físico: ${summary.scope.promotableHistoricalOnly}.\n`
    + `- Pendientes de revisión manual: ${summary.scope.pendingManualReview}.\n`
    + `- Conteo esperado tras promociones aprobadas: ${summary.scope.expectedCountAfterApprovedPromotions}.\n\n`
    + `## Estados detectados\n\n| Estado | Cantidad |\n|---|---:|\n${counts}\n\n`
    + conflictSection
    + `## Regla de seguridad\n\n`
    + `Una coincidencia histórica se vincula al producto activo y nunca se suma automáticamente. `
    + `Los registros sin coincidencia requieren conteo físico y aprobación antes de promoverse.\n`;
}

async function main() {
  const argv = minimist(process.argv.slice(2));
  const projectId = String(argv.project || '').trim();
  if (!projectId) throw new Error('Debes indicar --project=<id>.');
  if (argv.apply || argv.write || argv.commit) {
    throw new Error('Este comando es estrictamente de solo lectura y no admite flags de escritura.');
  }
  const dateKey = new Date().toISOString().slice(0, 10);
  const outputsRoot = path.resolve(process.cwd(), 'outputs');
  const outputDir = path.resolve(argv.output || path.join(outputsRoot, `inventory-reconciliation-${dateKey}`));
  if (outputDir !== outputsRoot && !outputDir.startsWith(`${outputsRoot}${path.sep}`)) {
    throw new Error('La salida debe permanecer dentro de outputs/.');
  }
  const apiv2Path = path.join(FIREBASE_TOOLS_ROOT, 'lib', 'apiv2.js');
  const authPath = path.join(FIREBASE_TOOLS_ROOT, 'lib', 'auth.js');
  if (!fs.existsSync(apiv2Path) || !fs.existsSync(authPath)) {
    throw new Error('No se encontró la instalación autenticada de Firebase CLI.');
  }
  const auth = require(authPath);
  const { getAccessToken } = require(apiv2Path);
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error('Firebase CLI no tiene una cuenta autenticada para este proyecto.');
  auth.setActiveAccount({}, account);
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Firebase CLI no devolvió una sesión autenticada.');

  const [existencias, productosAseo, movimientos] = await Promise.all([
    listCollectionDocuments({ projectId, collectionId: 'existencias', accessToken }),
    listCollectionDocuments({ projectId, collectionId: 'productos_aseo', accessToken }),
    listCollectionDocuments({ projectId, collectionId: 'movimientos', accessToken }),
  ]);
  const result = reconcileHistoricalInventory({ existencias, productosAseo, movimientos });
  fs.mkdirSync(outputDir, { recursive: true });

  const snapshot = JSON.stringify({
    generatedAt: new Date().toISOString(),
    projectId,
    readOnly: true,
    collections: { existencias, productos_aseo: productosAseo },
    movementEvidenceNote: 'Los movimientos completos no se duplican en este respaldo; solo se exporta la evidencia vinculada.',
  }, null, 2);
  const summary = JSON.stringify({
    generatedAt: new Date().toISOString(),
    projectId,
    readOnly: true,
    ...result.summary,
  }, null, 2);
  const csv = rowsToCsv(result.rows);
  const reconciliationJson = JSON.stringify(result.rows, null, 2);
  const movementEvidence = JSON.stringify(result.movementEvidence, null, 2);
  const review = buildReviewMarkdown(result.summary, result.rows);
  const files = {
    'live-source-snapshot.json': snapshot,
    'summary.json': summary,
    'reconciliation.csv': csv,
    'reconciliation.json': reconciliationJson,
    'movement-evidence.json': movementEvidence,
    'REVIEW.md': review,
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputDir, name), content, 'utf8');
  }
  const manifest = Object.entries(files).map(([name, content]) => ({
    file: name,
    bytes: Buffer.byteLength(content),
    sha256: sha256(content),
  }));
  fs.writeFileSync(path.join(outputDir, 'manifest.sha256.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(JSON.stringify({
    status: 'success',
    readOnly: true,
    outputDir,
    summary: result.summary,
  }, null, 2));
}

module.exports = {
  normalizeAseoCode,
  normalizeText,
  reconcileHistoricalInventory,
  rowsToCsv,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
