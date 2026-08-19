# 📊 Sistema de Logging y Monitoring

## 📋 Descripción General

Sistema completo de logging integrado con Firebase Analytics para capturar:
- ❌ Errores no capturados
- ⚠️ Advertencias de la aplicación
- 👤 Acciones de usuario
- 🔐 Eventos de autenticación
- 💾 Sincronización de datos
- ⚡ Métricas de performance

## 🎯 Componentes Implementados

### 1. **Logger Central** (`src/utils/logger.ts`)

Sistema de logging con métodos tipados:

```typescript
import { Logger } from './utils/logger';

// Errores
Logger.error(new Error('Algo malo pasó'), {
  component: 'MyComponent',
  action: 'operationName',
  metadata: { id: 123 }
});

// Advertencias
Logger.warn('Esto es extraño', {
  component: 'DataSync',
  metadata: { status: 'pending' }
});

// Acciones de usuario
Logger.userAction('generated_excel_report', {
  component: 'InventoryModule',
  userId: user.uid,
  metadata: { rowCount: 500, timeMs: 2300 }
});

// Autenticación
Logger.auth('login', user.uid, true, { provider: 'email' });
Logger.auth('logout', user.uid, true);

// Sincronización de datos
Logger.dataSync('fetch_inventory', 'articulos', 'success', { count: 450 });

// Performance
Logger.performance('excel_generation', 2300, 3000); // Alerta si > 3s
```

**Características:**
- ✅ Se guarda en Google Analytics (si está disponible)
- ✅ Se guarda en localStorage (últimos 50 errores)
- ✅ Logging en consola automático
- ✅ Timestamping automático
- ✅ Tipado completo con TypeScript

### 2. **ErrorBoundary Mejorado** (`src/ErrorBoundary.tsx`)

Captura errores de React y los loguea automáticamente:

```typescript
// Automático - se loguea cualquier error no capturado
// + Muestra detalles en desarrollo
// + Ofrece recuperación (Recargar / Cerrar sesión)
```

**Mejoras:**
- ✅ Integración automática con Logger
- ✅ Detalle de stack en desarrollo
- ✅ UI mejorada
- ✅ Tratamiento de errores durante logout

### 3. **Role Change Listener** (`src/hooks/useUserRoleListener.ts`)

Monitorea cambios de rol/estado en tiempo real:

```typescript
import { useUserRoleListener } from './hooks/useUserRoleListener';

function App() {
  useUserRoleListener(user, () => {
    // Callback: usuario fue desautorizado
    console.log('Usuario desactivado o rol removido');
  });
}
```

**Comportamiento:**
- ✅ Escucha cambios en `usuarios/{uid}` en Firestore
- ✅ Valida: `activo`, `estado`, `rol`
- ✅ Hace logout automático si usuario es desactivado
- ✅ Loguea todos los eventos en Firebase Analytics

### 4. **Global Error Handler** (`setupGlobalErrorHandler()`)

Captura errores no capturados por React:

```typescript
// En main.tsx - se inicializa automáticamente
import { setupGlobalErrorHandler } from './utils/logger';
setupGlobalErrorHandler();
```

**Captura:**
- ✅ Errores globales (`window.error`)
- ✅ Promise rejections no manejadas
- ✅ Los loguea automáticamente en Logger

## 🔄 Flujo de Datos

```
Error/Evento
    ↓
Logger.method()
    ├→ console.log/warn/error
    ├→ Firebase Analytics (si disponible)
    └→ localStorage (para errores)
    
Errores no capturados
    ↓
setupGlobalErrorHandler()
    └→ Captura → Logger.error()
    
React Errors
    ↓
ErrorBoundary.componentDidCatch()
    └→ Logger.error() + UI de recuperación
    
Cambios de rol
    ↓
useUserRoleListener()
    ├→ onSnapshot(usuarios/{uid})
    ├→ Valida estado
    └→ Logout automático si es necesario
```

## 📊 Datos en Firebase Analytics

Se registran automáticamente como eventos:

### Eventos de Error
```json
{
  "event_name": "app_error",
  "parameters": {
    "error_message": "Cannot read property 'x' of undefined",
    "error_component": "InventoryView",
    "error_action": "processEntry",
    "user_id": "user123",
    "timestamp": "2024-01-20T15:30:00Z"
  }
}
```

### Eventos de Autenticación
```json
{
  "event_name": "auth_event",
  "parameters": {
    "auth_event": "login",
    "user_id": "user123",
    "success": true,
    "provider": "email"
  }
}
```

### Eventos de Sincronización
```json
{
  "event_name": "data_sync",
  "parameters": {
    "sync_event": "fetch_inventory",
    "collection_name": "articulos",
    "sync_status": "success",
    "count": 450
  }
}
```

### Eventos de Performance
```json
{
  "event_name": "performance_metric",
  "parameters": {
    "metric_name": "excel_generation",
    "duration_ms": 2300,
    "is_slow": false,
    "threshold_ms": 3000
  }
}
```

## 🛠️ Cómo Usar en Componentes

### En TypeScript
```typescript
import { Logger } from '../utils/logger';

// En un handler
const handleSubmit = async (data) => {
  try {
    Logger.userAction('submit_entry_form', {
      component: 'EntryForm',
      userId: user.uid
    });
    
    await submitData(data);
    Logger.dataSync('submit_entry', 'movimientos', 'success');
  } catch (error) {
    Logger.error(error, {
      component: 'EntryForm',
      action: 'submit_failed',
      userId: user.uid
    });
  }
};
```

### En try-catch
```typescript
try {
  const result = await processInventory();
} catch (error) {
  Logger.error(
    error instanceof Error ? error : new Error(String(error)),
    {
      component: 'InventoryProcessor',
      action: 'process_failed',
      metadata: { itemCount: items.length }
    }
  );
}
```

### Para Performance
```typescript
const start = Date.now();
await generateExcelReport(items);
const duration = Date.now() - start;

Logger.performance('generate_excel_report', duration, 5000); // Alerta si > 5s
```

## 💾 Acceder a Logs Locales

Para debugging, acceder a errores guardados:

```typescript
import { getErrorLogs, clearErrorLogs } from './utils/logger';

// En la consola del navegador
getErrorLogs(20) // Últimos 20 errores
clearErrorLogs() // Limpiar todos
```

Los logs también están en:
```
localStorage['app_error_logs']
```

## 🔍 Ver Datos en Firebase Console

1. Ir a Firebase Console → Analytics
2. Dashboard mostrará en tiempo real:
   - Usuarios activos
   - Eventos principales
   - Errores más comunes
3. En "Events", filtrar por evento tipo:
   - `app_error`
   - `auth_event`
   - `data_sync`
   - `performance_metric`

## ⚙️ Configuración

### Actualmente Habilitado
- ✅ Google Analytics (si está disponible)
- ✅ Console logging
- ✅ localStorage (errores)
- ✅ Global error handler
- ✅ ErrorBoundary
- ✅ Role listener

### Para Deshabilitar Google Analytics
```typescript
// En src/utils/logger.ts
// Comentar la línea:
// analytics = getAnalytics();
```

### Para Aumentar Límite de Errores en localStorage
```typescript
// En src/utils/logger.ts, función saveErrorLog()
// Cambiar: if (logs.length > 50)
if (logs.length > 100) // Aumentar a 100
```

## 🚀 Próximos Pasos

1. **Monitoreo en producción:**
   - Los datos están siendo capturados en Firebase Analytics
   - Ver en https://console.firebase.google.com → Project "arles-gestion" → Analytics

2. **Agregar alertas:**
   - Firebase puede enviar alertas si errores aumentan
   - Configurar en Firebase Console → Alerts

3. **Integración avanzada:**
   - Agregar Crash Reporting (Firebase Crashlytics)
   - Implementar rate limiting para analytics
   - Dashboard personalizado en Firebase

## ✅ Checklist de Validación

- [ ] Errores se loguean en consola
- [ ] Errores aparecen en Analytics
- [ ] localStorage tiene registro de errores
- [ ] ErrorBoundary captura errores de componentes
- [ ] Role listener desloguea usuarios al cambiar rol
- [ ] Global error handler captura unhandled rejections
- [ ] Performance metrics se registran para Excel
- [ ] Auth events se loguean correctamente

---

**Fecha de Creación:** 2024-01-20  
**Versión:** 1.0  
**Estado:** ✅ Completo e Integrado
