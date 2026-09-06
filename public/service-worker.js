/* Retirement worker: keep this URL for previously registered clients.
 * No fetch interception, offline writes, forced navigation or IndexedDB deletion.
 */
const LEGACY_CACHES = new Set([
  'almacen-arles-v0.1.8',
  'almacen-arles-assets-v0.2.0',
  'almacen-arles-api-v0.2.0',
  'almacen-arles-inventory-v0.2.0',
]);
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => LEGACY_CACHES.has(key)).map((key) => caches.delete(key)));
    await self.registration.unregister();
  })());
});
