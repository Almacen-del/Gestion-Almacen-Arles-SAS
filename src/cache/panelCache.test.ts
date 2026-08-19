import { describe, expect, it } from 'vitest';
import {
  PANEL_CACHE_MAX_BYTES,
  PANEL_CACHE_TTL_MS,
  loadPanelCache,
  panelCacheKey,
  savePanelCache,
} from './panelCache';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const context = { uid: 'usuario-a', projectId: 'arles-gestion' };
const data = {
  inventory: [{ id: 'uno' }],
  aseoInventory: [],
  tools: [],
  lastSync: '2026-07-13T12:00:00.000Z',
};

describe('caché segura del panel', () => {
  it('aísla la clave por UID y proyecto Firebase', () => {
    expect(panelCacheKey(context)).not.toBe(panelCacheKey({ ...context, uid: 'usuario-b' }));
    expect(panelCacheKey(context)).not.toBe(panelCacheKey({ ...context, projectId: 'otro-proyecto' }));
  });

  it('nunca entrega datos almacenados por otro usuario', () => {
    const storage = new MemoryStorage();
    savePanelCache(storage, context, data, 1_000);

    expect(loadPanelCache(storage, { ...context, uid: 'usuario-b' }, 1_001)).toBeNull();
  });

  it('elimina la caché legacy y descarta caché vencida', () => {
    const storage = new MemoryStorage();
    storage.setItem('gestion-almacen-panel-cache-v1', JSON.stringify({ users: { secret: true } }));
    savePanelCache(storage, context, data, 1_000);

    expect(storage.getItem('gestion-almacen-panel-cache-v1')).toBeNull();
    expect(loadPanelCache(storage, context, 1_000 + PANEL_CACHE_TTL_MS + 1)).toBeNull();
    expect(storage.getItem(panelCacheKey(context))).toBeNull();
  });

  it('solo serializa inventarios y metadatos, no usuarios, movimientos ni evidencias', () => {
    const storage = new MemoryStorage();
    savePanelCache(storage, context, {
      ...data,
      users: { uid: 'no-guardar' },
      movements: [{ fotoUrl: 'evidencia' }],
    } as typeof data, 1_000);
    const serialized = storage.getItem(panelCacheKey(context)) ?? '';

    expect(serialized).not.toContain('users');
    expect(serialized).not.toContain('movements');
    expect(serialized).not.toContain('evidencia');
  });

  it('elimina una caché que contenga campos sensibles no permitidos', () => {
    const storage = new MemoryStorage();
    savePanelCache(storage, context, data, 1_000);
    const key = panelCacheKey(context);
    const stored = JSON.parse(storage.getItem(key) ?? '{}') as Record<string, unknown>;
    storage.setItem(key, JSON.stringify({ ...stored, users: { filtrado: true } }));

    expect(loadPanelCache(storage, context, 1_001)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it('rechaza y elimina entradas que superan el límite de tamaño', () => {
    const storage = new MemoryStorage();
    const saved = savePanelCache(storage, context, {
      ...data,
      inventory: [{ id: 'x'.repeat(PANEL_CACHE_MAX_BYTES) }],
    }, 1_000);

    expect(saved).toBe(false);
    expect(storage.getItem(panelCacheKey(context))).toBeNull();
  });
});
