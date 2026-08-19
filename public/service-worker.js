/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'almacen-arles-v0.1.8';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];
/**
 * Service Worker mejorado con estrategia de caché avanzada
 * 
 * Estrategias:
 * - Network First: Firebase, APIs externas (datos críticos)
 * - Cache First: Assets locales (JS, CSS, imágenes)
 * - Stale While Revalidate: Datos de inventario (balance entre velocidad y actualidad)
 */

// Versionado automático para invalidación de caché
const CACHE_VERSION = '0.2.0';
const CACHE_NAMES = {
  assets: `almacen-arles-assets-v${CACHE_VERSION}`,
  api: `almacen-arles-api-v${CACHE_VERSION}`,
  inventory: `almacen-arles-inventory-v${CACHE_VERSION}`,
};

// URLs críticas que siempre se cachean
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/module-icons/inventario.svg',
  '/module-icons/valoracion.svg',
  '/module-icons/indicadores.svg',
];

// Patrones de URLs para diferentes estrategias
const PATTERNS = {
  firebase: /firebaseio\.com|googleapis\.com|firebasestorage\.app/,
  assets: /\.(js|css|png|jpg|jpeg|svg|gif|webp|woff|woff2)$/i,
  inventory: /\/inventario|\/articulos|\/movimientos/,
};

// TTL (Time To Live) para caché en ms
const CACHE_TTL = {
  assets: 30 * 24 * 60 * 60 * 1000, // 30 días
  api: 5 * 60 * 1000, // 5 minutos
  inventory: 10 * 60 * 1000, // 10 minutos
};@@
/**
 * Install: Cachear URLs críticas
 */
// Instalar el service worker
self.addEventListener('install', (event) => {
    caches.open(CACHE_NAMES.assets).then((cache) => {
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting();
});
/**
 * Activate: Limpiar cachés antiguas
 */
// Activar el service worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
          // Mantener solo las cachés actuales
          const isCurrentCache = Object.values(CACHE_NAMES).includes(cacheName);
          if (!isCurrentCache) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});
/**
 * Fetch: Estrategias de caché inteligentes
 * 
 * 1. Firebase/API: Network First (datos siempre actualizados)
 * 2. Assets: Cache First (máximo rendimiento)
 * 3. Inventario: Stale While Revalidate (balance)
 */
// Si falla, usar cache si está disponible
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // 1️⃣ Firebase y APIs externas: Network First
  // Firebase y APIs externas: Network First
    PATTERNS.firebase.test(url.toString())
    url.hostname.includes('googleapis.com')
  ) {
    event.respondWith(
      fetch(request)
          // Cachear si es exitosa
          if (response.ok && request.method === 'GET') {
            const cloned = response.clone();
            caches.open(CACHE_NAMES.api).then((cache) => {
              cache.put(request, cloned);
            });
          }
          // No cachear respuestas de Firebase en fetch
          return response;
        })
          // Fallback: intentar cache
          // Si no hay conexión, intentar cache
            if (cached) {
              return cached;
            }
            return new Response('Sin conexión', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            });
            return cached || new Response('Sin conexión', { status: 503 });
          });
        })
    );
    return;
  }
  // 2️⃣ Assets locales (.js, .css, .svg, etc): Cache First
  if (PATTERNS.assets.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(request).then((response) => {
          if (response.ok && request.method === 'GET') {
            const cloned = response.clone();
            caches.open(CACHE_NAMES.assets).then((cache) => {
              cache.put(request, cloned);
            });
          }
          return response;
        });
      })
    );
    return;
  }
  // Assets locales: Cache First, Fall back to Network
  // 3️⃣ Datos de inventario: Stale While Revalidate
  // Devuelve caché inmediatamente, actualiza en background
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
        // Devolver caché
        if (request.method === 'GET') {
          // Actualizar en background
          fetch(request).then((response) => {
            if (response.ok) {
              const cloned = response.clone();
              caches.open(CACHE_NAMES.inventory).then((cache) => {
                cache.put(request, cloned);
              });
            }
          }).catch(() => {
            // Si falla en background, ignorar
          });
        }
        return cached;
      return fetch(request).then((response) => {
        // No cachear en todas las solicitudes por seguridad
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
          caches.open(CACHE_NAMES.inventory).then((cache) => {
          });
        }
        return response;
      });
      }).catch(() => {
        // Si no hay caché y falla en red
        return new Response('Sin conexión', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
    })
  );
});

// Manejo de mensajes desde la app
/**
 * Manejo de mensajes desde la app
 * - SKIP_WAITING: Activar SW nueva versión
 * - CLEAR_CACHE: Limpiar caché manualmente
 * - GET_CACHE_SIZE: Obtener tamaño de caché
 */
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((cacheNames) => {
      Promise.all(
        cacheNames.map((cacheName) => {
          return caches.delete(cacheName);
        })
      );
    });
  }
  
  if (event.data && event.data.type === 'GET_CACHE_SIZE') {
    // Obtener tamaño estimado (requiere Storage API)
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((estimate) => {
        event.ports[0].postMessage({
          usage: estimate.usage,
          quota: estimate.quota,
        });
      });
    }
  }
