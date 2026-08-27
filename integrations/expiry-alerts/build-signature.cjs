// Genera un recurso de Apps Script a partir de la imagen aprobada, sin modificarla.
// No publica la imagen, no utiliza credenciales y no hace solicitudes externas.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const imagePath = path.join(__dirname, 'assets', 'firma-avisos-arles.png');
const outputPath = path.join(__dirname, 'SignatureAsset.gs');
const bytes = fs.readFileSync(imagePath);
if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error('La firma aprobada no es un archivo PNG.');
}
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const encoded = bytes.toString('base64');
const chunks = encoded.match(/.{1,8000}/g);
const generated = '// Generado por build-signature.cjs. No editar manualmente.\n'
  + '// SHA-256 de firma-avisos-arles.png: ' + hash + '\n'
  + 'const EXPIRY_SIGNATURE_BASE64 = [\n'
  + chunks.map((chunk) => '  ' + JSON.stringify(chunk)).join(',\n')
  + '\n].join(\'\');\n';
fs.writeFileSync(outputPath, generated, 'utf8');
console.log('Firma empaquetada sin cambios: ' + bytes.length + ' bytes; SHA-256 ' + hash);
