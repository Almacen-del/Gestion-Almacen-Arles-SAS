/**
 * Hook para manejo completo de PWA (Progressive Web App)
 * - Instalación de app
 * - Notificaciones de actualizaciones
 * - Control del Service Worker
 * - Gestión de caché
 */

import { useEffect, useState } from 'react';
import { Logger } from '../utils/logger';

interface CacheInfo {
  usage: number;
  quota: number;
  percentageUsed: number;
}

interface PWAState {
  isInstallable: boolean;
  isInstalled: boolean;
  updateAvailable: boolean;
  cacheInfo: CacheInfo | null;
  swStatus: 'installing' | 'installed' | 'updating' | 'error' | 'idle';
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let swController: ServiceWorkerContainer | null = null;

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

/**
 * Hook para utilidades de PWA completas
 */
export function usePWA() {
  const [state, setState] = useState<PWAState>({
    isInstallable: false,
    isInstalled: false,
    updateAvailable: false,
    cacheInfo: null,
    swStatus: 'idle',
  });

  /**
   * Registrar el Service Worker
   */
  const registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator)) {
      Logger.warn('Service Worker no disponible', { component: 'usePWA' });
      return;
    }

    try {
      setState((prev) => ({ ...prev, swStatus: 'installing' }));
      swController = navigator.serviceWorker;

      const registration = await swController.register('/service-worker.js', {
        scope: '/',
      });

      setState((prev) => ({ ...prev, swStatus: 'installed' }));

      Logger.userAction('service_worker_registered', {
        component: 'usePWA',
        metadata: { scope: registration.scope },
      });

      // Escuchar updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setState((prev) => ({ ...prev, updateAvailable: true }));
            notifyUpdate();
          }
        });
      });

      // Escuchar controlador cambios
      swController.addEventListener('controllerchange', () => {
        Logger.userAction('service_worker_activated', {
          component: 'usePWA',
        });
      });
    } catch (error) {
      setState((prev) => ({ ...prev, swStatus: 'error' }));
      Logger.error(error instanceof Error ? error : new Error(String(error)), {
        component: 'usePWA',
        action: 'register_failed',
      });
    }
  };

  /**
   * Obtener información del caché
   */
  const getCacheSize = async () => {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      return;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentageUsed = quota > 0 ? (usage / quota) * 100 : 0;

      setState((prev) => ({
        ...prev,
        cacheInfo: { usage, quota, percentageUsed },
      }));

      Logger.userAction('cache_size_checked', {
        component: 'usePWA',
        metadata: {
          usageMB: (usage / 1024 / 1024).toFixed(2),
          quotaMB: (quota / 1024 / 1024).toFixed(2),
          percentageUsed: percentageUsed.toFixed(1),
        },
      });
    } catch (error) {
      Logger.error(error instanceof Error ? error : new Error(String(error)), {
        component: 'usePWA',
        action: 'get_cache_size_failed',
      });
    }
  };

  /**
   * Limpiar caché manualmente
   */
  const clearCache = async () => {
    if (!swController) {
      return;
    }

    try {
      const worker = swController.controller;
      if (worker) {
        worker.postMessage({ type: 'CLEAR_CACHE' });
        Logger.userAction('cache_cleared', {
          component: 'usePWA',
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
        await getCacheSize();
      }
    } catch (error) {
      Logger.error(error instanceof Error ? error : new Error(String(error)), {
        component: 'usePWA',
        action: 'clear_cache_failed',
      });
    }
  };

  /**
   * Mostrar notificación de actualización disponible
   */
  const notifyUpdate = () => {
    const message = '📦 Nueva versión disponible. ¿Recargar la aplicación?';

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Actualización disponible', {
        body: message,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        tag: 'update-notification',
      });
    }

    console.log('ℹ️', message);

    Logger.userAction('update_available', {
      component: 'usePWA',
    });
  };

  /**
   * Actualizar a la nueva versión del Service Worker
   */
  const updateServiceWorker = async () => {
    if (!swController?.controller) {
      return;
    }

    try {
      setState((prev) => ({ ...prev, swStatus: 'updating' }));

      swController.controller.postMessage({ type: 'SKIP_WAITING' });

      const onControllerChange = () => {
        swController?.removeEventListener('controllerchange', onControllerChange);
        window.location.reload();
      };

      swController.addEventListener('controllerchange', onControllerChange);

      Logger.userAction('service_worker_updated', {
        component: 'usePWA',
      });
    } catch (error) {
      setState((prev) => ({ ...prev, swStatus: 'error' }));
      Logger.error(error instanceof Error ? error : new Error(String(error)), {
        component: 'usePWA',
        action: 'update_failed',
      });
    }
  };

  /**
   * Solicitar instalación de app
   */
  const installApp = async () => {
    if (!deferredPrompt) {
      return;
    }

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      Logger.userAction('pwa_install_prompt', {
        component: 'usePWA',
        metadata: { outcome },
      });

      if (outcome === 'accepted') {
        deferredPrompt = null;
        setState((prev) => ({ ...prev, isInstalled: true }));
      }
    } catch (error) {
      Logger.error(error instanceof Error ? error : new Error(String(error)), {
        component: 'usePWA',
        action: 'install_failed',
      });
    }
  };

  /**
   * Detectar eventos beforeinstallprompt
   */
  const setupInstallPrompt = () => {
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      setState((prev) => ({ ...prev, isInstallable: true }));

      Logger.userAction('pwa_installable_detected', {
        component: 'usePWA',
      });
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  };

  /**
   * Inicializar PWA al montar componente
   */
  useEffect(() => {
    registerServiceWorker();
    const cleanup = setupInstallPrompt();

    getCacheSize();

    const interval = setInterval(getCacheSize, 5 * 60 * 1000);

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, []);

  return {
    ...state,
    installApp,
    updateServiceWorker,
    clearCache,
    getCacheSize,
    registerServiceWorker,
  };
}

/**
 * Hook específico para manejo de instalación
 * @deprecated Usar usePWA() en su lugar
 */
export function usePWAInstall() {
  const { isInstallable, installApp } = usePWA();
  return { isInstallable, installApp };
}

/**
 * Hook específico para manejo de actualizaciones
 * @deprecated Usar usePWA() en su lugar
 */
export function usePWAUpdates() {
  const { updateAvailable, updateServiceWorker } = usePWA();
  return { updateAvailable, updateServiceWorker };
}
