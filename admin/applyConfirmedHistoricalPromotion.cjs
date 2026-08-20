const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const minimist = require('minimist');

const FIREBASE_TOOLS_ROOT = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools');
const REQUIRED_CONFIRMATION = 'PROMOVER-16-HISTORICOS-CONTEO-CONFIRMADO';

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  return null;
}

function fieldValue(document, ...keys) {
  for (const key of keys) {
    if (document.fields?.[key]) return decodeValue(document.fields[key]);
  }
  return null;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function firestoreDocumentUrl(projectId, documentId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + `/databases/(default)/documents/existencias/${encodeURIComponent(documentId)}`;
}

async function firebaseAccessToken() {
  const apiv2Path = path.join(FIREBASE_TOOLS_ROOT, 'lib', 'apiv2.js');
  const authPath = path.join(FIREBASE_TOOLS_ROOT, 'lib', 'auth.js');
  if (!fs.existsSync(apiv2Path) || !fs.existsSync(authPath)) {
    throw new Error('No se encontró Firebase CLI autenticado.');
  }
  const auth = require(authPath);
  const { getAccessToken } = require(apiv2Path);
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account) throw new Error('No hay una cuenta autenticada de Firebase CLI.');
  auth.setActiveAccount({}, account);
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Firebase CLI no devolvió acceso autenticado.');
  return accessToken;
}

async function fetchDocument(projectId, documentId, accessToken) {
  const response = await fetch(firestoreDocumentUrl(projectId, documentId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`No se pudo leer existencias/${documentId}: HTTP ${response.status}.`);
  return response.json();
}

function validateReview(review, projectId) {
  if (review.projectId !== projectId) throw new Error('El proyecto del acta no coincide.');
  if (review.decision !== 'promote-as-active-without-summing') throw new Error('La decisión del acta no está autorizada.');
  if (!review.verifiedBy?.trim() || !review.evidenceReference?.trim()) {
    throw new Error('El acta no contiene responsable y evidencia.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.confirmedAt || '')) throw new Error('La fecha del acta no es válida.');
  if (!Array.isArray(review.items) || review.items.length !== 16) throw new Error('El acta debe contener exactamente 16 productos.');
  const ids = new Set();
  review.items.forEach((item) => {
    if (!item.documentId || ids.has(item.documentId)) throw new Error('El acta contiene identificadores vacíos o duplicados.');
    if (!Number.isInteger(item.physicalCount) || item.physicalCount < 0) {
      throw new Error(`Conteo físico inválido para ${item.documentId}.`);
    }
    ids.add(item.documentId);
  });
}

function buildWrite(projectId, item, document) {
  return {
    update: {
      name: `projects/${projectId}/databases/(default)/documents/existencias/${item.documentId}`,
      fields: {
        modulo: { stringValue: 'Consumibles' },
        cantidad: { integerValue: String(item.physicalCount) },
      },
    },
    updateMask: { fieldPaths: ['modulo', 'cantidad'] },
    currentDocument: { updateTime: document.updateTime },
  };
}

async function main() {
  const argv = minimist(process.argv.slice(2));
  const projectId = String(argv.project || '').trim();
  const reviewPath = path.resolve(String(argv.review || ''));
  const outputDir = path.resolve(String(argv.output || path.dirname(reviewPath)));
  const outputsRoot = path.resolve(process.cwd(), 'outputs');
  if (!projectId || !argv.review || !fs.existsSync(reviewPath)) throw new Error('Faltan --project y --review válidos.');
  if (!reviewPath.startsWith(`${outputsRoot}${path.sep}`) || !outputDir.startsWith(`${outputsRoot}${path.sep}`)) {
    throw new Error('El acta y la evidencia deben permanecer dentro de outputs/.');
  }
  if (!argv.apply || argv.confirm !== REQUIRED_CONFIRMATION) {
    throw new Error(`Escritura bloqueada. Requiere --apply --confirm=${REQUIRED_CONFIRMATION}.`);
  }
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  validateReview(review, projectId);
  const accessToken = await firebaseAccessToken();
  const documents = await Promise.all(review.items.map((item) => fetchDocument(projectId, item.documentId, accessToken)));

  review.items.forEach((item, index) => {
    const document = documents[index];
    const module = normalizeText(fieldValue(document, 'modulo'));
    const recordedCount = fieldValue(document, 'cantidad', 'stock_actual', 'stock', 'saldo');
    if (module !== 'CONSUMIBLES HISTORICO') throw new Error(`${item.documentId} ya no pertenece a Consumibles historico.`);
    if (recordedCount !== item.physicalCount) {
      throw new Error(`${item.documentId} cambió: Firestore=${recordedCount}, conteo confirmado=${item.physicalCount}.`);
    }
  });

  fs.mkdirSync(outputDir, { recursive: true });
  const backupContent = JSON.stringify({
    generatedAt: new Date().toISOString(),
    projectId,
    purpose: 'pre-write-backup-confirmed-historical-promotion',
    documents,
  }, null, 2);
  const backupPath = path.join(outputDir, 'pre-write-backup-confirmed-promotion.json');
  fs.writeFileSync(backupPath, backupContent, 'utf8');
  const backupHash = sha256(backupContent);
  fs.writeFileSync(`${backupPath}.sha256`, `${backupHash}  ${path.basename(backupPath)}\n`, 'utf8');

  const writes = review.items.map((item, index) => buildWrite(projectId, item, documents[index]));
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
  const response = await fetch(commitUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  if (!response.ok) throw new Error(`Firestore rechazó la operación atómica: HTTP ${response.status}.`);
  const commitResult = await response.json();

  const verifiedDocuments = await Promise.all(
    review.items.map((item) => fetchDocument(projectId, item.documentId, accessToken)),
  );
  verifiedDocuments.forEach((document, index) => {
    const item = review.items[index];
    if (normalizeText(fieldValue(document, 'modulo')) !== 'CONSUMIBLES') {
      throw new Error(`Verificación fallida: ${item.documentId} no quedó en Consumibles.`);
    }
    if (fieldValue(document, 'cantidad') !== item.physicalCount) {
      throw new Error(`Verificación fallida: cantidad incorrecta en ${item.documentId}.`);
    }
  });

  const result = {
    status: 'success',
    projectId,
    atomicCommit: true,
    promotedDocuments: review.items.length,
    totalConfirmedUnits: review.items.reduce((sum, item) => sum + item.physicalCount, 0),
    commitTime: commitResult.commitTime || null,
    backupPath,
    backupSha256: backupHash,
    verifiedDocumentIds: review.items.map((item) => item.documentId),
  };
  fs.writeFileSync(path.join(outputDir, 'confirmed-promotion-result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
