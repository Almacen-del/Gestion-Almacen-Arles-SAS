// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';

const sdk = vi.hoisted(() => ({ isSupported: vi.fn(), initializeAnalytics: vi.fn(), logEvent: vi.fn() }));
vi.mock('firebase/analytics', () => sdk);
const app = { options: { appId: 'test-app', measurementId: 'G-TEST' } } as FirebaseApp;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sdk.isSupported.mockResolvedValue(true);
  sdk.initializeAnalytics.mockReturnValue({ name: 'fake-analytics' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('diagnósticos seguros y orden de inicialización', () => {
  it('importar el logger y usarlo antes de Firebase no inicia Analytics', async () => {
    const logger = await import('./logger');
    logger.Logger.error('Una excepción');
    expect(sdk.initializeAnalytics).not.toHaveBeenCalled();
    expect(logger.getMonitoringStatus()).toBe('local');
    expect(logger.getErrorLogs()).toHaveLength(1);
  });
  it.each(['disabled', 'missing-config', 'do-not-track'])('no transmite con %s', async (scenario) => {
    const { initializeMonitoring } = await import('./logger');
    if (scenario === 'do-not-track') Object.defineProperty(navigator, 'doNotTrack', { value: '1' });
    await initializeMonitoring(scenario === 'missing-config' ? { options: {} } as FirebaseApp : app, { enabled: scenario !== 'disabled' });
    expect(sdk.isSupported).not.toHaveBeenCalled();
    expect(sdk.initializeAnalytics).not.toHaveBeenCalled();
  });
  it('usa explícitamente la aplicación ya creada y desactiva páginas/publicidad', async () => {
    const { initializeMonitoring } = await import('./logger');
    await Promise.all([initializeMonitoring(app, { enabled: true }), initializeMonitoring(app, { enabled: true })]);
    expect(sdk.initializeAnalytics).toHaveBeenCalledTimes(1);
    expect(sdk.initializeAnalytics).toHaveBeenCalledWith(app, { config: expect.objectContaining({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: location.origin, page_referrer: '',
    }) });
  });
  it.each(['unsupported', 'failed'])('no rompe el panel si Analytics está %s', async (scenario) => {
    if (scenario === 'unsupported') sdk.isSupported.mockResolvedValue(false);
    else sdk.isSupported.mockRejectedValue(new Error('offline'));
    const { initializeMonitoring, Logger } = await import('./logger');
    expect(await initializeMonitoring(app, { enabled: true })).toBe('unavailable');
    expect(() => Logger.error('Error de negocio')).not.toThrow();
    expect(sdk.logEvent).not.toHaveBeenCalled();
  });
  it('entrega al destino simulado solo campos permitidos, sin mensajes ni identidades', async () => {
    const { initializeMonitoring, Logger, getErrorLogs } = await import('./logger');
    await initializeMonitoring(app, { enabled: true });
    const error = Object.assign(new Error('Juan - correo@privado.com token=SECRETO producto FER159 cantidad 850000'), { code: 'firestore/permission-denied' });
    Logger.error(error, { userId: 'UID-SECRETO', component: 'useUserRoleListener', action: 'FER159', metadata: { producto: 'SECRETO' } });
    expect(sdk.logEvent).toHaveBeenLastCalledWith(expect.anything(), 'app_diagnostic', {
      diagnostic_kind: 'error', diagnostic_source: 'useUserRoleListener',
      diagnostic_category: 'permission-denied', app_release: 'local-dev',
    });
    Logger.warn('otro SECRETO', { component: 'correo@privado.com' });
    expect(getErrorLogs().at(-1)?.source).toBe('application');
    const captured = JSON.stringify([sdk.logEvent.mock.calls, getErrorLogs(), sessionStorage.getItem('arles_technical_diagnostics_v1')]);
    expect(captured).not.toMatch(/SECRETO|Juan|privado|850000|FER159/);
  });
  it('limita cola inicial, eventos por sesión y errores locales', async () => {
    let ready!: (supported: boolean) => void;
    sdk.isSupported.mockImplementation(() => new Promise<boolean>((resolve) => { ready = resolve; }));
    const logger = await import('./logger');
    const initializing = logger.initializeMonitoring(app, { enabled: true });
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'));
    for (let i = 0; i < 15; i++) logger.Logger.error('error');
    ready(true);
    await initializing;
    expect(sdk.logEvent).toHaveBeenCalledTimes(10);
    for (let i = 0; i < 70; i++) logger.Logger.error('error');
    expect(sdk.logEvent).toHaveBeenCalledTimes(20);
    expect(logger.getErrorLogs(100)).toHaveLength(50);
    expect(logger.getErrorLogs(0)).toEqual([]);
    logger.clearErrorLogs();
    expect(logger.getErrorLogs()).toEqual([]);
  });
  it('fallos del destino o del almacenamiento no propagan excepciones', async () => {
    const logger = await import('./logger');
    await logger.initializeMonitoring(app, { enabled: true });
    sdk.logEvent.mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => logger.Logger.error('Error')).not.toThrow();
  });
  it('instala una sola pareja de manejadores y borra solo los antiguos logs', async () => {
    const logger = await import('./logger');
    localStorage.setItem('app_error_logs', '["datos antiguos"]');
    localStorage.setItem('sesion-ajena', 'conservar');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const remove = logger.setupGlobalErrorHandler();
    expect(logger.setupGlobalErrorHandler()).toBe(remove);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('privado') }));
    expect(logger.getErrorLogs()).toHaveLength(1);
    expect(localStorage.getItem('app_error_logs')).toBeNull();
    expect(localStorage.getItem('sesion-ajena')).toBe('conservar');
    remove();
    expect(removeListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    expect(logger.getErrorLogs()).toHaveLength(1);
  });
});
