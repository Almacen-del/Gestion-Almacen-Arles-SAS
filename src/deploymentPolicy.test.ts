import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import deployment from '../vercel.json';
import firebase from '../firebase.json';
import pkg from '../package.json';

describe('una sola publicación y CSP coherente', () => {
  const headers = Object.fromEntries(deployment.headers[0].headers.map(({ key, value }) => [key, value]));
  it('no deja comandos de despliegue web hacia Firebase', () => {
    expect(firebase).not.toHaveProperty('hosting');
    for (const script of [pkg.scripts['deploy:web'], pkg.scripts['deploy:all'], pkg.scripts['deploy:hosting']]) {
      expect(script).toBe('node scripts/deployment-policy.mjs');
    }
    const result = spawnSync(process.execPath, ['scripts/deployment-policy.mjs'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NO publica nada');
  });
  it('mantiene las funciones de lotes, autenticación y App Check permitidas', () => {
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain('https://us-central1-arles-gestion.cloudfunctions.net');
    expect(csp).toContain('https://*.googleapis.com');
    expect(csp).toContain('https://*.firebaseapp.com');
    expect(csp).toContain('https://www.google.com/recaptcha/');
    expect(csp).not.toMatch(/unsafe-eval|127\.0\.0\.1|localhost/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers['X-Frame-Options']).toBe('DENY');
  });
  it('no retiene HTML/versiones antiguas y reserva caché largo para assets hash', () => {
    expect(headers['Cache-Control']).toContain('max-age=0');
    expect(deployment.headers[1].source).toBe('/assets/(.*)');
    expect(deployment.headers[1].headers[0].value).toContain('immutable');
  });
  it('no anuncia instalación ni usa una segunda CSP divergente en index', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toMatch(/rel="manifest"|web-app-capable|Content-Security-Policy/);
  });
});
