export const PANEL_CACHE_VERSION = 2;
export const PANEL_CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
export const PANEL_CACHE_MAX_BYTES = 1_000_000;

const PANEL_CACHE_PREFIX = 'gestion-almacen-panel-cache-v2';
const LEGACY_PANEL_CACHE_KEYS = ['gestion-almacen-panel-cache-v1'];

export type PanelCacheContext = {
  uid: string;
  projectId: string;
};

export type PanelCacheData<T> = {
  inventory: T[];
  aseoInventory: T[];
  tools: T[];
  lastSync: string;
};

type StoredPanelCache<T> = PanelCacheData<T> & PanelCacheContext & {
  version: typeof PANEL_CACHE_VERSION;
  savedAt: number;
  expiresAt: number;
};

type CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function panelCacheKey({ uid, projectId }: PanelCacheContext) {
  return `${PANEL_CACHE_PREFIX}:${encodeURIComponent(projectId)}:${encodeURIComponent(uid)}`;
}

export function removeLegacyPanelCache(storage: CacheStorage) {
  LEGACY_PANEL_CACHE_KEYS.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // El panel puede continuar sin localStorage.
    }
  });
}

function safelyRemove(storage: CacheStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // El panel puede continuar sin localStorage.
  }
}

function isValidStoredCache<T>(
  value: Partial<StoredPanelCache<T>>,
  context: PanelCacheContext,
  now: number,
): value is StoredPanelCache<T> {
  const allowedKeys = new Set([
    'version',
    'uid',
    'projectId',
    'savedAt',
    'expiresAt',
    'inventory',
    'aseoInventory',
    'tools',
    'lastSync',
  ]);
  return Object.keys(value).every((key) => allowedKeys.has(key))
    && value.version === PANEL_CACHE_VERSION
    && value.uid === context.uid
    && value.projectId === context.projectId
    && typeof value.savedAt === 'number'
    && typeof value.expiresAt === 'number'
    && value.savedAt <= now
    && value.expiresAt > now
    && Array.isArray(value.inventory)
    && Array.isArray(value.aseoInventory)
    && Array.isArray(value.tools)
    && typeof value.lastSync === 'string';
}

export function loadPanelCache<T>(
  storage: CacheStorage,
  context: PanelCacheContext,
  now = Date.now(),
): PanelCacheData<T> | null {
  removeLegacyPanelCache(storage);
  const key = panelCacheKey(context);

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    if (new TextEncoder().encode(raw).byteLength > PANEL_CACHE_MAX_BYTES) {
      safelyRemove(storage, key);
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredPanelCache<T>>;
    if (!isValidStoredCache(parsed, context, now)) {
      safelyRemove(storage, key);
      return null;
    }
    return {
      inventory: parsed.inventory,
      aseoInventory: parsed.aseoInventory,
      tools: parsed.tools,
      lastSync: parsed.lastSync,
    };
  } catch {
    safelyRemove(storage, key);
    return null;
  }
}

export function savePanelCache<T>(
  storage: CacheStorage,
  context: PanelCacheContext,
  data: PanelCacheData<T>,
  now = Date.now(),
) {
  removeLegacyPanelCache(storage);
  const key = panelCacheKey(context);
  try {
    const stored: StoredPanelCache<T> = {
      version: PANEL_CACHE_VERSION,
      uid: context.uid,
      projectId: context.projectId,
      savedAt: now,
      expiresAt: now + PANEL_CACHE_TTL_MS,
      inventory: data.inventory,
      aseoInventory: data.aseoInventory,
      tools: data.tools,
      lastSync: data.lastSync,
    };
    const serialized = JSON.stringify(stored);
    if (new TextEncoder().encode(serialized).byteLength > PANEL_CACHE_MAX_BYTES) {
      safelyRemove(storage, key);
      return false;
    }
    storage.setItem(key, serialized);
    return true;
  } catch {
    safelyRemove(storage, key);
    return false;
  }
}

export function hasPanelCacheData<T>(cache: PanelCacheData<T>) {
  return cache.inventory.length > 0
    || cache.aseoInventory.length > 0
    || cache.tools.length > 0;
}
