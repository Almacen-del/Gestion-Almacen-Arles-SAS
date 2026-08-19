const admin = require('firebase-admin');
const path = require('path');

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

(async function main() {
  try {
    console.log('Conectando a Firestore...');
    const collections = await db.listCollections();
    console.log(`Colecciones encontradas: ${collections.length}`);

    for (const coll of collections) {
      console.log('----');
      console.log(`Colección: ${coll.id}`);
      const snap = await db.collection(coll.id).limit(5).get();
      console.log(`  Muestra de documentos (hasta 5): ${snap.size}`);
      snap.forEach(doc => {
        console.log(`    - id: ${doc.id}`);
        console.log(`      data: ${JSON.stringify(doc.data(), null, 2)}`);
      });
    }

    console.log('Inspección completada.');
  } catch (err) {
    console.error('Error durante inspección:', err);
    process.exit(2);
  }
})();
