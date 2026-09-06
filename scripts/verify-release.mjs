import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'dist');
const html = readFileSync(resolve(directory, 'index.html'), 'utf8');
const release = JSON.parse(readFileSync(resolve(directory, 'release.json'), 'utf8'));
assert.match(release.id, /^(?:[a-f0-9]{12}|local)(?:-local)?$/);
assert.ok(html.includes(`content="${release.id}"`), 'El HTML debe identificar el mismo artefacto');
assert.ok(!html.includes('rel="manifest"'), 'No anunciar la PWA retirada');
assert.ok(!existsSync(resolve(directory, 'manifest.json')), 'No publicar el manifiesto obsoleto');
assert.ok(html.includes('us-central1-arles-gestion.cloudfunctions.net'), 'CSP debe permitir las funciones de lotes');
assert.ok(!html.includes('127.0.0.1'), 'No permitir conexiones de desarrollo en producción');
for (const [, path] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) {
  assert.ok(existsSync(resolve(directory, `.${path}`)), `Recurso faltante: ${path}`);
}
console.log(`Artefacto verificado: ${release.id}`);
