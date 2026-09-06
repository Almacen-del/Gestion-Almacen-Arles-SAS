import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import deployment from './vercel.json';

// The same production policy is exercised in preview and delivered by Vercel.
const headers = Object.fromEntries(deployment.headers[0].headers.map(({ key, value }) => [key, value]));
const csp = headers['Content-Security-Policy'];
let revision = 'local';
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* source archive */ }
const vercelRevision = process.env.VERCEL_GIT_COMMIT_SHA;
const isVercelBuild = process.env.VERCEL === '1';
if (isVercelBuild && !/^[a-f0-9]{40}$/.test(vercelRevision ?? '')) throw new Error('Vercel debe proporcionar el commit de esta publicación.');
if (isVercelBuild) revision = vercelRevision!;
const release = { id: `${revision.slice(0, 12)}${isVercelBuild ? '' : '-local'}`, revision, builtAt: new Date().toISOString() };

export default defineConfig({
  base: '/',
  define: { __APP_RELEASE__: JSON.stringify(release) },
  plugins: [react(), {
    name: 'arles-release-policy',
    transformIndexHtml(_html, context) {
      // frame-ancestors only works as an HTTP header; no contradictory meta policy.
      let policy = csp.replace(/frame-ancestors [^;]+;\s*/, '');
      if (context.server) policy = policy
        .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5174 http://127.0.0.1:5174")
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"); // React Refresh, development only.
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
        { tag: 'meta', attrs: { name: 'arles-release', content: release.id }, injectTo: 'head' }];
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify(release, null, 2) });
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
});
