import type { RpcTransport } from './contracts';

const PROJECT_URL = 'https://gfgsnnweyfryfcqdnlvw.supabase.co';
const READ_FUNCTIONS = new Set(['warehouse_catalog', 'warehouse_confirmed_movements', 'warehouse_historical_movements']);
export interface AccessToken { value: string; expiresAt: number }
export class SessionRequiredError extends Error {
  constructor() { super('Inicia sesión en Supabase para consultar el panel.'); }
}

/** Read-only transport. Does not reuse Firebase credentials or accept a service-role key. */
export function createSupabaseReaderTransport(options: {
  url: string; publishableKey: string; accessToken: () => Promise<AccessToken | null>;
  fetch?: typeof fetch; now?: () => number;
}): RpcTransport {
  if (options.url !== PROJECT_URL || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(options.publishableKey))
    throw new Error('Configura el proyecto Supabase del almacén y su clave publicable.');
  const request = options.fetch ?? fetch;
  return { async call(name, args, signal) {
    if (!READ_FUNCTIONS.has(name)) throw new Error('Operación no permitida por el lector del panel.');
    signal?.throwIfAborted();
    const token = await options.accessToken();
    if (!token?.value || token.expiresAt <= (options.now?.() ?? Date.now())) throw new SessionRequiredError();
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, {once:true});
    const timeout = setTimeout(() => controller.abort(new Error('La consulta tardó demasiado. Reintenta.')), 30_000);
    try {
      const response = await request(`${PROJECT_URL}/rest/v1/rpc/${name}`, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: {apikey: options.publishableKey, Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(args),
      });
      if (response.status === 401 || response.status === 403) throw new SessionRequiredError();
      if (!response.ok) throw new Error('Supabase no pudo completar la consulta. Los datos anteriores se conservan.');
      return await response.json();
    } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort)}
  }};
}
