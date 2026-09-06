// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { retireLegacyPwa } from './retireLegacyPwa';

afterEach(() => vi.unstubAllGlobals());
describe('retiro de la PWA incompleta', () => {
  it('el JS de retiro instala y se elimina sin interceptar tráfico o recargar', async () => {
    const callbacks: Record<string, (event: unknown) => void> = {};
    const unregister = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    const self = { addEventListener: (name: string, handler: (event: unknown) => void) => { callbacks[name] = handler; },
      skipWaiting: vi.fn().mockResolvedValue(undefined), registration: { unregister } };
    runInNewContext(readFileSync('public/service-worker.js', 'utf8'), { self, caches: {
      keys: async () => ['almacen-arles-api-v0.2.0', 'otra-app', 'firebase-cache'], delete: remove,
    } });
    const waits: Promise<unknown>[] = [];
    const event = { waitUntil: (promise: Promise<unknown>) => waits.push(promise) };
    callbacks.install(event);
    callbacks.activate(event);
    await Promise.all(waits);
    expect(Object.keys(callbacks)).toEqual(['install', 'activate']);
    expect(remove.mock.calls).toEqual([['almacen-arles-api-v0.2.0']]);
    expect(unregister).toHaveBeenCalledOnce();
  });
  it('no borra otros workers/cachés ni registra uno nuevo', async () => {
    const owned = { scope: `${location.origin}/`, active: { scriptURL: `${location.origin}/service-worker.js` }, unregister: vi.fn() };
    const other = { scope: `${location.origin}/`, active: { scriptURL: `${location.origin}/firebase-messaging-sw.js` }, unregister: vi.fn() };
    const subpath = { scope: `${location.origin}/otra/`, active: owned.active, unregister: vi.fn() };
    const mixed = { ...owned, waiting: other.active, unregister: vi.fn() };
    const register = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [owned, other, subpath, mixed], register } });
    const remove = vi.fn();
    vi.stubGlobal('caches', { keys: async () => ['almacen-arles-v0.1.8', 'otra-app'], delete: remove });
    await retireLegacyPwa();
    expect(owned.unregister).toHaveBeenCalledOnce();
    for (const r of [other, subpath, mixed]) expect(r.unregister).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(remove.mock.calls).toEqual([['almacen-arles-v0.1.8']]);
  });
  it('funciona sin soporte de service worker ni Cache Storage', async () => {
    vi.stubGlobal('navigator', {});
    await expect(retireLegacyPwa()).resolves.toBeUndefined();
  });
});
