/**
 * Sistema de logging y monitoreo para producción
 * Captura errores, eventos y métricas en Firebase
 */

import { getAnalytics, logEvent } from 'firebase/analytics';

let analytics: ReturnType<typeof getAnalytics> | null = null;

try {
  analytics = getAnalytics();
} catch {
  console.warn('Google Analytics no disponible');
}

// Tipos de eventos
export enum LogEventType {
  ERROR = 'error',
  WARNING = 'warning',
  USER_ACTION = 'user_action',
  PERFORMANCE = 'performance',
  AUTH = 'auth',
  DATA_SYNC = 'data_sync',
}

interface LogContext {
  userId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Logger central para la aplicación
 */
export const Logger = {
  /**
   * Log de errores
   */
  error: (error: Error | string, context?: LogContext) => {
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : '';

    console.error(`[ERROR] ${message}`, { stack, context });

    // Enviar a Analytics si está disponible
    if (analytics) {
      try {
        logEvent(analytics, 'app_error', {
          error_message: message,
          error_component: context?.component || 'unknown',
          error_action: context?.action || '',
          user_id: context?.userId || 'anonymous',
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Error al loguear error:', e);
      }
    }

    // Guardar en localStorage para debugging
    saveErrorLog({
      type: 'error',
      message,
      stack,
      context,
      timestamp: Date.now(),
    });
  },

  /**
   * Log de advertencias
   */
  warn: (message: string, context?: LogContext) => {
    console.warn(`[WARN] ${message}`, context);

    if (analytics) {
      try {
        logEvent(analytics, 'app_warning', {
          warning_message: message,
          component: context?.component || 'unknown',
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Error al loguear warning:', e);
      }
    }
  },

  /**
   * Log de acciones de usuario
   */
  userAction: (action: string, context?: LogContext) => {
    console.log(`[USER ACTION] ${action}`, context?.metadata);

    if (analytics) {
      try {
        logEvent(analytics, 'user_action', {
          action_name: action,
          component: context?.component || 'unknown',
          user_id: context?.userId || 'anonymous',
          ...context?.metadata,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Error al loguear user action:', e);
      }
    }
  },

  /**
   * Log de autenticación
   */
  auth: (event: string, userId: string, success: boolean, details?: Record<string, unknown>) => {
    console.log(`[AUTH] ${event}:`, { userId, success, details });

    if (analytics) {
      try {
        logEvent(analytics, 'auth_event', {
          auth_event: event,
          user_id: userId,
          success,
          ...details,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Error al loguear auth:', e);
      }
    }
  },

  /**
   * Log de sincronización de datos
   */
  dataSync: (event: string, collection: string, status: 'success' | 'error' | 'pending', details?: Record<string, unknown>) => {
    console.log(`[DATA SYNC] ${event} - ${collection}:`, { status, details });

    if (analytics) {
      try {
        logEvent(analytics, 'data_sync', {
          sync_event: event,
          collection_name: collection,
          sync_status: status,
          ...details,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Error al loguear data sync:', e);
      }
    }
  },

  /**
   * Log de performance
   */
  performance: (metric: string, duration: number, threshold?: number) => {
    const isSlowOk = !threshold || duration <= threshold;
    const level = isSlowOk ? 'log' : 'warn';
    console[level](`[PERFORMANCE] ${metric}: ${duration}ms`, { threshold });

    if (analytics) {
      try {
        logEvent(analytics, 'performance_metric', {
          metric_name: metric,
          duration_ms: duration,
          is_slow: !isSlowOk,
          threshold_ms: threshold || 0,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Error al loguear performance:', e);
      }
    }
  },
};

/**
 * Guardar errores localmente para debugging
 */
function saveErrorLog(log: {
  type: string;
  message: string;
  stack?: string;
  context?: LogContext;
  timestamp: number;
}) {
  try {
    const key = 'app_error_logs';
    const existing = localStorage.getItem(key);
    const logs = existing ? JSON.parse(existing) : [];

    logs.push(log);

    // Mantener solo los últimos 50 errores
    if (logs.length > 50) {
      logs.shift();
    }

    localStorage.setItem(key, JSON.stringify(logs));
  } catch (e) {
    console.error('Error al guardar log:', e);
  }
}

/**
 * Obtener logs de error guardados (para debugging)
 */
export function getErrorLogs(limit = 10) {
  try {
    const key = 'app_error_logs';
    const existing = localStorage.getItem(key);
    const logs = existing ? JSON.parse(existing) : [];
    return logs.slice(-limit);
  } catch (e) {
    console.error('Error al obtener logs:', e);
    return [];
  }
}

/**
 * Limpiar logs de error
 */
export function clearErrorLogs() {
  try {
    localStorage.removeItem('app_error_logs');
  } catch (e) {
    console.error('Error al limpiar logs:', e);
  }
}

/**
 * Interceptor global de errores
 */
export function setupGlobalErrorHandler() {
  // Errores no capturados
  window.addEventListener('error', (event) => {
    Logger.error(event.error || new Error(event.message), {
      component: 'window:error',
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // Promise rejections no manejadas
  window.addEventListener('unhandledrejection', (event) => {
    Logger.error(
      event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
      {
        component: 'window:unhandledrejection',
        metadata: { promise: String(event.promise) },
      }
    );
  });
}
