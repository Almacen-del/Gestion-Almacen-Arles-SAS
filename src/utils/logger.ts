import type { FirebaseApp } from 'firebase/app';
import { APP_RELEASE } from '../release';

interface LogContext {
  userId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}
type MonitoringStatus = 'local' | 'initializing' | 'remote' | 'unavailable';
type Diagnostic = {
  kind: 'error' | 'warning' | 'auth' | 'action' | 'sync' | 'performance';
  source: string;
  category: string;
  release: string;
  timestamp: number;
};
const sources = new Set([
  'bootstrap', 'ErrorBoundary', 'useUserRoleListener', 'retireLegacyPwa',
  'window:error', 'window:unhandledrejection',
]);
const categories = new Set([
  'permission-denied', 'unauthenticated', 'unavailable', 'deadline-exceeded',
  'resource-exhausted', 'failed-precondition', 'network-request-failed',
]);
let status: MonitoringStatus = 'local';
let initialization: Promise<MonitoringStatus> | undefined;
let send: ((diagnostic: Diagnostic) => void) | undefined;
let sent = 0;
const queued: Diagnostic[] = [];
const memoryLogs: Diagnostic[] = [];
const storageKey = 'arles_technical_diagnostics_v1';

export function getMonitoringStatus() { return status; }

function categoryOf(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  const category = typeof code === 'string' ? code.split('/').at(-1) ?? '' : '';
  return categories.has(category) ? category : 'unexpected';
}

function emit(diagnostic: Diagnostic) {
  if (!send || sent >= 20) return;
  sent += 1;
  try { send(diagnostic); } catch { /* Diagnostics must never break a business operation. */ }
}

function record(kind: Diagnostic['kind'], context?: LogContext, category = 'event') {
  const diagnostic: Diagnostic = {
    kind, source: sources.has(context?.component ?? '') ? context!.component! : 'application',
    category, release: APP_RELEASE.id, timestamp: Date.now(),
  };
  // Never persist/send messages, stacks, user IDs, free text, URLs or metadata.
  if (kind === 'error' || kind === 'warning') {
    memoryLogs.push(diagnostic);
    if (memoryLogs.length > 50) memoryLogs.shift();
    try { sessionStorage.setItem(storageKey, JSON.stringify(memoryLogs)); } catch { /* unavailable storage */ }
    console[kind === 'error' ? 'error' : 'warn']('[Diagnóstico técnico]', diagnostic);
  }
  if (status === 'initializing') {
    if (queued.length < 10) queued.push(diagnostic);
  } else if (status === 'remote') emit(diagnostic);
}

/** Called explicitly AFTER initializeApp, never as a side effect of importing Logger.
 * Remote collection requires deployment opt-in; unsupported/offline browsers stay local.
 */
export function initializeMonitoring(app: FirebaseApp, options: { enabled: boolean }): Promise<MonitoringStatus> {
  if (!options.enabled || navigator.doNotTrack === '1' ||
      !app.options.appId || !app.options.measurementId) return Promise.resolve(status);
  if (initialization) return initialization;
  status = 'initializing';
  initialization = (async () => {
    try {
      const sdk = await import('firebase/analytics');
      if (!await sdk.isSupported()) { status = 'unavailable'; return status; }
      const analytics = sdk.initializeAnalytics(app, { config: {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: location.origin,
        page_referrer: '',
        page_title: 'Gestión de Almacén',
      } });
      send = (diagnostic) => sdk.logEvent(analytics, 'app_diagnostic', {
        diagnostic_kind: diagnostic.kind,
        diagnostic_source: diagnostic.source,
        diagnostic_category: diagnostic.category,
        app_release: diagnostic.release,
      });
      status = 'remote'; // SDK configured, not a guarantee of delivery through an ad blocker.
      queued.splice(0).forEach(emit);
      return status;
    } catch {
      status = 'unavailable';
      return status;
    } finally {
      queued.length = 0;
    }
  })();
  return initialization;
}

export const Logger = {
  error: (error: Error | string, context?: LogContext) => record('error', context, categoryOf(error)),
  warn: (_message: string, context?: LogContext) => record('warning', context),
  userAction: (_action: string, context?: LogContext) => record('action', context),
  auth: (_event: string, _userId: string, success: boolean, _details?: Record<string, unknown>) =>
    record('auth', undefined, success ? 'success' : 'failure'),
  dataSync: (_event: string, _collection: string, result: 'success' | 'error' | 'pending', _details?: Record<string, unknown>) =>
    record('sync', undefined, result),
  performance: (_metric: string, duration: number, threshold?: number) =>
    record('performance', undefined, threshold && duration > threshold ? 'slow' : 'normal'),
};

export function getErrorLogs(limit = 10): Diagnostic[] {
  const count = Number.isFinite(limit) ? Math.max(0, Math.min(50, Math.floor(limit))) : 10;
  return count ? memoryLogs.slice(-count) : [];
}
export function clearErrorLogs() {
  memoryLogs.length = 0;
  try { sessionStorage.removeItem(storageKey); } catch { /* unavailable storage */ }
}
let removeGlobalHandlers: (() => void) | undefined;
export function setupGlobalErrorHandler() {
  if (removeGlobalHandlers) return removeGlobalHandlers;
  // The old logger stored raw messages/identities indefinitely. Remove only its own key.
  try { localStorage.removeItem('app_error_logs'); } catch { /* unavailable storage */ }
  const onError = (event: ErrorEvent) => Logger.error(event.error || event.message, { component: 'window:error' });
  const onRejection = (event: PromiseRejectionEvent) =>
    Logger.error(event.reason, { component: 'window:unhandledrejection' });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  removeGlobalHandlers = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    removeGlobalHandlers = undefined;
  };
  return removeGlobalHandlers;
}
