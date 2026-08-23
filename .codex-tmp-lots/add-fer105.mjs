import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const projectId = 'arles-gestion';
const productId = 'Q-FER105-BODEGA-AZUL';
const lotId = '23-07-55__2027-07-04';
const token = execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], { encoding: 'utf8' }).trim();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const productUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/existencias/${productId}`;
const lotUrl = `${productUrl}/lotes_agroquimicos/${lotId}`;

const productResponse = await fetch(productUrl, { headers });
if (!productResponse.ok) throw new Error(`No se pudo leer FER105: ${await productResponse.text()}`);
const product = await productResponse.json();
const stock = Number(product.fields?.cantidad?.integerValue ?? product.fields?.cantidad?.doubleValue ?? 0);
if (stock !== 7000) throw new Error(`FER105 cambió: el disponible actual es ${stock}, no 7000.`);

const previousLotResponse = await fetch(lotUrl, { headers });
if (previousLotResponse.status !== 404) throw new Error('El lote FER105 ya existe; no se sobrescribió.');

const backupPath = 'C:/Users/Almacen/Desktop/respaldos_gestion/fer105-antes-2026-08-22.json';
await fs.writeFile(backupPath, JSON.stringify({ projectId, product, lotBefore: null }, null, 2));

const fields = {
  producto_id: { stringValue: productId },
  codigo_producto: { stringValue: 'FER105' },
  producto: { stringValue: 'Microckel Calcio Boro' },
  numero_lote: { stringValue: '23 07 55' },
  fecha_vencimiento: { stringValue: '2027-07-04' },
  precision_vencimiento: { stringValue: 'dia' },
  fecha_ingreso: { stringValue: '2026-08-22' },
  fecha_ingreso_estimada: { booleanValue: true },
  cantidad_inicial: { integerValue: '7000' },
  cantidad_disponible: { integerValue: '7000' },
  asignaciones_entrada: { arrayValue: { values: [] } },
  unidad: { stringValue: product.fields?.unidad?.stringValue || 'ML' },
  ubicacion: { stringValue: product.fields?.ubicacion?.stringValue || 'BODEGA AZUL' },
  origen_registro: { stringValue: 'importacion_fisica_excel' },
  archivo_origen: { stringValue: 'lotes_y_fechas_vencimiento.xlsx' },
  fecha_registro: { stringValue: '2026-08-22' },
};
const commitResponse = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ writes: [{ update: { name: lotUrl.replace('https://firestore.googleapis.com/v1/', ''), fields }, currentDocument: { exists: false } }] }),
});
if (!commitResponse.ok) throw new Error(`No se pudo guardar FER105: ${await commitResponse.text()}`);

const verifyResponse = await fetch(lotUrl, { headers });
if (!verifyResponse.ok) throw new Error(`FER105 se escribió pero no pudo verificarse: ${await verifyResponse.text()}`);
const verified = await verifyResponse.json();
console.log(JSON.stringify({
  productId,
  lot: verified.fields?.numero_lote?.stringValue,
  expiration: verified.fields?.fecha_vencimiento?.stringValue,
  quantity: Number(verified.fields?.cantidad_disponible?.integerValue ?? verified.fields?.cantidad_disponible?.doubleValue),
  backupPath,
}, null, 2));
