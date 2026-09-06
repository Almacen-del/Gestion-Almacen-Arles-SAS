// Only remove registrations/caches owned by the retired, incomplete web PWA.
// Firebase persistence and other applications sharing the origin are untouched.
const legacyCaches = new Set([
  'almacen-arles-v0.1.8', 'almacen-arles-assets-v0.2.0',
  'almacen-arles-api-v0.2.0', 'almacen-arles-inventory-v0.2.0',
]);

export async function retireLegacyPwa() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter((registration) => {
      if (registration.scope !== new URL('/', location.origin).href) return false;
      const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
      return workers.length > 0 && workers.every((worker) => (
        worker!.scriptURL === new URL('/service-worker.js', location.origin).href
      ));
    }).map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => legacyCaches.has(key)).map((key) => caches.delete(key)));
  }
}
