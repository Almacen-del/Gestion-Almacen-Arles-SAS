const admin = require('firebase-admin');
const path = require('path');

const argv = require('minimist')(process.argv.slice(2));
const collectionName = argv.collection || 'inventario';
const applyChanges = Boolean(argv.apply);
const limit = Number(argv.limit) || 0;

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.');
  process.exit(1);
}

const servicePath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const serviceAccount = require(servicePath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function pickString(obj, ...keys) {
  for (const k of keys) {
    if (!obj) continue;
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function pickNumber(obj, ...keys) {
  for (const k of keys) {
    if (!obj) continue;
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

(async function main() {
  try {
    console.log(`Conectando a Firestore y transformando collection: ${collectionName}`);
    let q = db.collection(collectionName);
    if (limit > 0) q = q.limit(limit);
    const snap = await q.get();
    console.log(`Documentos a procesar: ${snap.size}`);

    let updated = 0;
    for (const doc of snap.docs) {
      const data = doc.data();

      const modulo = pickString(data, 'modulo', 'module') || 'Sin módulo';
      const codigo = pickString(data, 'codigo_interno', 'codigo', 'codigo_principal', 'codigo_qr', 'code') || doc.id;
      const descripcion = pickString(data, 'item', 'producto', 'nombre') || doc.id;
      const referencia = pickString(data, 'referencia', 'ref', 'talla') || '';
      const categoria = pickString(data, 'categoria') || 'General';
      const unidad = pickString(data, 'unidad') || 'Unidad';
      const saldo = pickNumber(data, 'cantidad', 'stock_actual', 'stock', 'saldo');

      const update = {
        modulo,
        codigo,
        descripcion,
        referencia,
        categoria,
        unidad,
        saldo,
        _lastTransformedAt: new Date().toISOString(),
      };

      if (applyChanges) {
        await doc.ref.set(update, { merge: true });
        updated += 1;
        console.log(`Applied update to ${doc.id}`);
      } else {
        console.log(`Dry-run for ${doc.id}: ${JSON.stringify(update)}`);
      }
    }

    if (applyChanges) {
      console.log(`Transformación aplicada a ${updated} documentos.`);
    } else {
      console.log('Dry-run completado. Para aplicar los cambios, reejecuta con --apply');
    }
  } catch (err) {
    console.error('Error durante transformación:', err);
    process.exit(2);
  }
})();
