# 📱 PWA y Service Worker - Guía Completa

## 📋 Descripción General

La aplicación está configurada como **Progressive Web App (PWA)** con:
- ✅ Instalación en dispositivos (Android, iOS, Windows, Mac)
- ✅ Funcionamiento offline completo
- ✅ Sincronización de datos en background
- ✅ Notificaciones de actualizaciones
- ✅ Caché inteligente con 3 estrategias diferentes

## 📦 Componentes PWA

### 1. **Manifest** (`public/manifest.json`)

Archivo de configuración de la app instalable:

```json
{
  "name": "Gestión de Almacén ARLES",
  "short_name": "ARLES",
  "description": "Sistema de gestión de inventario",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#087B3B",
  "background_color": "#ffffff",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "shortcuts": [
    {
      "name": "Inventario",
      "short_name": "Inventario",
      "description": "Ir al panel de inventario",
      "url": "/?panel=inventario",
      "icons": [{ "src": "/icons/icon-192x192.png", "sizes": "192x192" }]
    }
  ]
}
```

**Propósito:**
- Define cómo se ve la app cuando se instala
- Nombre, iconos, colores de tema
- Accesos directos (shortcuts)

### 2. **Service Worker** (`public/service-worker.js`)

Gestor de caché y funcionamiento offline:

```javascript
// Estrategias implementadas:
// 1. Network First (Firebase/APIs)
//    - Intenta obtener datos de la red primero
//    - Si falla, usa caché
//    - Siempre intenta estar actualizado

// 2. Cache First (Assets: JS, CSS, imágenes)
//    - Usa caché si existe
//    - Si no, descarga de la red
//    - Máximo rendimiento

// 3. Stale While Revalidate (Inventario)
//    - Devuelve caché inmediatamente
//    - Actualiza en background
//    - Balance entre velocidad y actualidad
```

**Versiones de Caché:**
```typescript
CACHE_NAMES = {
  assets: "almacen-arles-assets-v0.2.0",      // JS, CSS, imágenes
  api: "almacen-arles-api-v0.2.0",             // Respuestas de API
  inventory: "almacen-arles-inventory-v0.2.0" // Datos de inventario
}
```

### 3. **Hook usePWA** (`src/hooks/usePWA.ts`)

Control del PWA desde React:

```typescript
import { usePWA } from './hooks/usePWA';

function MyComponent() {
  const pwa = usePWA();
  
  // Estado
  console.log(pwa.isInstallable);    // true si puede instalarse
  console.log(pwa.isInstalled);      // true si ya está instalada
  console.log(pwa.updateAvailable);  // true si hay update
  console.log(pwa.swStatus);         // 'installed', 'updating', etc
  console.log(pwa.cacheInfo);        // { usage, quota, percentageUsed }
  
  // Funciones
  await pwa.installApp();            // Mostrar prompt de instalación
  await pwa.updateServiceWorker();   // Actualizar a nueva versión
  await pwa.clearCache();            // Limpiar caché manual
  await pwa.getCacheSize();          // Obtener tamaño actual
}
```

### 4. **index.html - Meta Tags**

Tags necesarios en `<head>`:

```html
<!-- PWA Meta Tags -->
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#087B3B" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="ARLES" />
```

## 🔄 Flujo de Funcionamiento

```
Usuario visita la app
    ↓
Service Worker se registra
    ↓
Caché de assets se inicializa
    ↓
En sesiones posteriores:
    ├─ Assets usados recientemente: desde caché (Cache First)
    ├─ Firebase/APIs: intenta red, fallback caché (Network First)
    └─ Inventario: caché inmediato + actualizar fondo (SWR)
    
Cuando hay update del código:
    ↓
SW nuevo detecta cambios
    ↓
Notificación: "Nueva versión disponible"
    ↓
Usuario acepta actualización
    ↓
usePWA().updateServiceWorker()
    ↓
Página se recarga con nueva versión
```

## 📊 Estrategias de Caché Explicadas

### Network First (Firebase/APIs)
```javascript
// Usar para: datos críticos que cambian frecuentemente
// Flujo:
1. Intenta conectarse a la red
2. Si éxito: devuelve datos + guarda en caché
3. Si falla: devuelve datos del caché
4. Si no hay caché: error

// Beneficio: Datos siempre actualizados
// Desventaja: Requiere conexión
```

**URLs que usan esto:**
- `firebaseio.com` (Firestore)
- `googleapis.com` (Google APIs)
- `firebasestorage.app` (Storage)

### Cache First (Assets)
```javascript
// Usar para: archivos que no cambian (JS, CSS, imágenes)
// Flujo:
1. Si existe en caché: devuelve caché
2. Si no existe: descarga de red + guarda caché
3. Si falla: error

// Beneficio: Máximo rendimiento, app "instantánea"
// Desventaja: Cambios requieren nueva versión del SW
```

**URLs que usan esto:**
- `*.js` - Archivos JavaScript
- `*.css` - Estilos
- `*.svg` - Iconos
- `*.png`, `*.jpg`, `*.webp` - Imágenes

### Stale While Revalidate (Datos Dinámicos)
```javascript
// Usar para: datos que cambian pero no son críticos
// Flujo:
1. Si existe caché: devuelve caché inmediatamente
2. En background: obtiene versión nueva de la red
3. Si obtiene versión nueva: actualiza caché
4. Próxima visita: usa versión actualizada

// Beneficio: Velocidad + actualización en background
// Desventaja: Puede mostrar datos ligeramente viejos
```

**URLs que usan esto:**
- `/inventario` - Tabla de artículos
- `/articulos` - Listado de artículos
- `/movimientos` - Histórico de movimientos

## 🚀 Instalación en Dispositivos

### Android
```
1. Abrir app en Chrome
2. Menú (⋮) → "Instalar app"
3. App aparecerá en pantalla de inicio
```

### iOS (PWA)
```
1. Abrir app en Safari
2. Compartir (↗) → "Agregar a pantalla de inicio"
3. App aparecerá en pantalla de inicio
```

### Windows
```
1. Abrir app en Edge/Chrome
2. Menú (⋮) → "Instalar aplicación"
3. Se crea acceso directo en desktop/menú inicio
```

### macOS
```
1. Abrir app en Safari/Chrome
2. Menú → "Instalar aplicación"
3. App aparecerá en Aplicaciones
```

## 🔄 Manejo de Actualizaciones

### Flujo Automático
```
1. Usuario tiene app v1 instalada
2. Se despliega v2 en el servidor
3. Service Worker detecta cambios
4. Notificación: "Nueva versión disponible"
5. Usuario hace click o app se recarga automáticamente
6. Se ejecuta v2
```

### Control Manual desde Código
```typescript
function UpdateButton() {
  const pwa = usePWA();
  
  if (!pwa.updateAvailable) return null;
  
  return (
    <button onClick={() => pwa.updateServiceWorker()}>
      📦 Actualizar ahora ({pwa.swStatus})
    </button>
  );
}
```

## 💾 Gestión de Caché

### Ver Tamaño de Caché
```typescript
const pwa = usePWA();

// Automático cada 5 minutos
console.log(pwa.cacheInfo);
// {
//   usage: 15728640,      // 15 MB
//   quota: 1073741824,    // 1 GB
//   percentageUsed: 1.47
// }
```

### Limpiar Caché Manualmente
```typescript
const pwa = usePWA();
await pwa.clearCache();

// También se puede hacer en DevTools:
// Storage → Cache → Eliminar almacenes
```

### Límites de Espacio
```
Límite por navegador:
- Chrome: ~10% del espacio en disco disponible
- Firefox: ~10% del espacio disponible
- Safari: ~50 MB
- Edge: ~10% del espacio disponible
```

## 🧪 Testing en Desarrollo

### Simular Offline
```javascript
// En DevTools (F12)
// Application → Service Workers → marcar "Offline"
// O en Network tab: cambiar a "Offline"
```

### Forzar Actualización del SW
```javascript
// En DevTools Console:
navigator.serviceWorker.getRegistrations().then(registrations => {
  registrations.forEach(r => r.unregister());
});
// Recargar página
```

### Ver Caché Almacenada
```javascript
// En DevTools:
// Application → Cache Storage → almacen-arles-*
// Muestra todos los URLs cacheados
```

## ⚠️ Consideraciones Importantes

### 1. HTTPS Requerido
- PWAs requieren HTTPS (excepto localhost)
- En desarrollo: http://localhost funciona
- En producción: https requerido

### 2. Actualizaciones Pueden ser Lentas
- Cambios de código requieren nueva versión del SW
- A veces se necesita recargar 2 veces
- Los usuarios pueden ver versión "vieja" un rato

### 3. Datos Offline
- Los datos descargados persisten
- Nuevos datos sin conexión no se sincronizan
- Cuando se recupera conexión, se sincroniza

### 4. Seguridad
- El caché es visible en DevTools
- No guardar datos sensibles directamente
- Usar encriptación si es necesario

## 🔧 Troubleshooting

### La app no se instala
```
Verificar:
1. ¿HTTPS? (o localhost)
2. ¿Manifest en index.html?
3. ¿Icons en las rutas correctas?
4. ¿Service Worker registrado?

Solución:
- DevTools → Application → Manifest
- Ver errores en la consola
```

### No carga sin conexión
```
Verificar:
1. ¿Service Worker activo?
2. ¿URLs en CACHE_NAMES?
3. ¿Estrategia correcta para esa URL?

Solución:
- Limpiar caché: pwa.clearCache()
- Esperar a que se re-cachee
- Recargar el SW
```

### Actualizaciones no funcionan
```
Verificar:
1. ¿Cambió el nombre de CACHE_VERSION?
2. ¿Service Worker se re-registró?
3. ¿Browser detecta cambios?

Solución:
- Hard refresh: Ctrl+Shift+R
- Limpiar caché en DevTools
- Incrementar CACHE_VERSION en service-worker.js
```

### Alto uso de espacio
```
Ver qué consume:
- DevTools → Application → Storage
- pwa.cacheInfo.usage (en MB)

Reducir:
- pwa.clearCache()
- Aumentar duración de caché
- Limitar URLs cacheadas
```

## 📊 Monitoreo en Producción

### Métricas a Monitorear
```typescript
// Esto se loguea automáticamente:
Logger.userAction('service_worker_registered', ...);
Logger.userAction('service_worker_activated', ...);
Logger.userAction('cache_size_checked', ...);
Logger.userAction('update_available', ...);
Logger.userAction('pwa_install_prompt', ...);
```

### Ver en Firebase Analytics
```
Console Firebase → arles-gestion → Analytics → Events
- Filtrar por: service_worker_registered
- Filtrar por: cache_size_checked
- Filtrar por: update_available
```

## ✅ Checklist de Validación

- [ ] Manifest.json es válido
- [ ] Icons existen en public/icons/
- [ ] Service Worker se registra sin errores
- [ ] App funciona sin conexión (offline)
- [ ] Caché se limpia al actualizar
- [ ] Actualización de versión funciona
- [ ] HTTPS configurado en producción
- [ ] Logs en Firebase Analytics correctos

---

**Fecha:** 2024-01-20  
**Versión:** 2.0 (Mejorada)  
**Estado:** ✅ En Producción
