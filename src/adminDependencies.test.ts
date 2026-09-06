import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
it('uuid reparado mantiene cargas multipart de gaxios/teeny-request y Admin sin credenciales', async () => {
  const bodies: { type: string; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      bodies.push({ type: request.headers['content-type'] ?? '', body });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Servidor local no disponible');
  const url = `http://127.0.0.1:${address.port}/test`;
  try {
    const { Gaxios } = require('gaxios');
    const result = await new Gaxios().request({ url, method: 'POST', multipart: [
      { headers: { 'Content-Type': 'text/plain' }, content: 'fixture-uno' },
      { headers: { 'Content-Type': 'text/plain' }, content: 'fixture-dos' },
    ] });
    expect(result.data).toEqual({ ok: true });
    const { teenyRequest } = require('teeny-request');
    const received = await new Promise((resolve, reject) => teenyRequest({ uri: url, method: 'POST', headers: {}, multipart: [
      { 'Content-Type': 'text/plain', body: 'fixture-uno' },
      { 'Content-Type': 'text/plain', body: Readable.from(['fixture-dos']) },
    ] }, (error: Error | null, _response: unknown, body: unknown) => error ? reject(error) : resolve(body)));
    expect(received).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.type).toMatch(/boundary=[a-f0-9-]{36}/);
      expect(body.body).toContain('fixture-uno');
      expect(body.body).toContain('fixture-dos');
    }
    const appSdk = require('firebase-admin/app');
    const app = appSdk.initializeApp({ projectId: 'demo-arles-stage4' }, 'stage4-test');
    try {
      expect(require('firebase-admin/firestore').getFirestore(app)).toBeTruthy();
      expect(require('firebase-admin/storage').getStorage(app)).toBeTruthy();
    } finally { await appSdk.deleteApp(app); }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}, 30000); // Cold imports of the Admin SDK can exceed Vitest's 5 s default on Windows.
