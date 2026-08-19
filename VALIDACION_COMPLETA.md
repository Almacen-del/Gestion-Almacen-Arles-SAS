# Validación Post-Migración Electron → Web

Este documento detalla todos los pasos completados y los pendientes para validar la migración de la aplicación Electron a una aplicación web con React + Firebase.

## ✅ COMPLETADO

### 1. Build y Dependencies
- ✅ `npm install` - todas las dependencias instaladas correctamente
- ✅ `npm test` - 125 tests pasados (20 suites)
- ✅ `npm run build` - compilación exitosa, `dist/` generado (1.3 MB minificado)
- ✅ Correcciones de TypeScript en módulo Excel (tipos ExcelJS)

### 2. Compilación
- ✅ TypeScript: sin errores
- ✅ Vite: optimizado para producción
- ✅ Assets: CSS, JS y dependencias bundleadas

### 3. Seguridad
- ✅ Firestore Rules v0.2 revisadas y mejoradas
  - Eliminada duplicación de código en validación de roles
  - Mejor separación de funciones: `isActive()`, `hasAllowedRole()`, `isAdmin()`
  - Comentarios sobre email del propietario (debe reemplazarse en producción)
  - Validación de estado activo/inactivo reforzada

### 4. Configuración
- ✅ Archivo `.env.local` creado con variables de ejemplo
- ✅ `vite.config.ts` configurado para SPA
- ✅ `firebase.json` con headers y redirects correctos

---

## 🔴 OBLIGATORIO - Antes de usar en producción

### 1. Reemplazar credenciales Firebase
**Archivo:** `.env.local`

```env
# Cambiar ESTOS valores con tus credenciales REALES de Firebase
VITE_FIREBASE_API_KEY=tu-api-key-real
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto-id
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=tu-sender-id
```

**Acción:** Copiar valores desde Firebase Console → Configuración del proyecto

### 2. Revisar propietario en Firestore Rules
**Archivo:** `firestore.rules` línea 14

Actualmente:
```
request.auth.token.email == 'juanestradafalla@gmail.com'
```

**Opciones para cambiar:**
1. Reemplazar el email por el del propietario actual
2. Añadir un documento `config/settings` con el UID del propietario
3. Usar un campo `isOwner: true` en el documento `usuarios/{uid}`

### 3. Validar roles reales en Firestore
**Acción:** Revisar documentos actuales en Firestore

```javascript
// En Firebase Console → Firestore, revisar:
// Colección: usuarios
// Campos esperados en cada documento:
{
  "activo": true/false,     // o "estado": "Activo"
  "rol": "almacenista",     // o valores actuales: admin, operador, etc.
  "email": "usuario@example.com"
}
```

**Si tus roles son diferentes**, actualizar `firestore.rules` líneas 45-48.

### 4. Probar en tu Firebase real
```bash
# Reemplaza .env.local con tus credenciales
npm run build
npm run preview
```

Luego:
1. Abre `http://localhost:4173`
2. Intenta login con un usuario que existe en tu Firebase
3. Verifica que se cargue el inventario
4. Prueba: entrada → salida → historial → Excel

### 5. Desplegar Firestore Rules (SOLO DESPUÉS de validar)
```bash
# Primero: revisar con los tests de emulador (si es posible)
firebase login
firebase deploy --only firestore:rules
```

**IMPORTANTE:** Esto afectará INMEDIATAMENTE todos los clientes (web, Electron, etc.)

---

## 🟠 IMPORTANTE - Antes de producción

### 6. Publicar en Firebase Hosting
```bash
firebase deploy --only hosting
```

Esto generará una URL pública:
```
https://tu-proyecto-id.web.app
https://tu-proyecto-id.firebaseapp.com
```

### 7. Configurar App Check (opcional pero recomendado)
**Firebase Console → App Check**

1. Registra la aplicación web
2. Obtén la Site Key de reCAPTCHA v3
3. Actualiza `.env`:
   ```env
   VITE_FIREBASE_APPCHECK_SITE_KEY=tu-site-key
   ```
4. Habilita enforcement en Firestore

### 8. Restricciones de API Key en Google Cloud
**Google Cloud Console → APIs y servicios → Credenciales**

Configura la API Key web para:
- Restricciones HTTP: solo dominios permitidos
- Restricciones de API: solo Cloud Firestore API

---

## 🟡 RECOMENDADO - Pruebas integrales

### 9. Probar flujo completo
Checklist en `CHECKLIST_FINAL.md`

```
✓ Login correcto
✓ Inventario carga
✓ Búsqueda funciona
✓ Entrada registra en Firestore
✓ Salida actualiza cantidades
✓ Excel descarga correctamente
✓ Logout funciona
```

### 10. Probar modo offline
1. Abre la app
2. Carga inventario
3. Abre DevTools → Network → Offline
4. Intenta crear una entrada
5. Reconecta internet
6. Verifica que Firestore sincronice

### 11. Probar con dos navegadores simultáneamente
1. Abre en Chrome: cambio de cantidad de producto X
2. Abre en Edge: actualiza y verifica que ve el cambio
3. Verifica que Firestore maneja la concurrencia

### 12. Pruebas en navegadores
- ✅ Chrome (Windows)
- ✅ Edge (Windows)
- 🔲 Firefox (verificar IndexedDB)
- 🔲 Safari (si aplica)

---

## 🟢 OPCIONAL - Mejoras posteriores

### 13. Convertir a PWA
Ya está parcialmente preparado. Para completar:

```bash
# Crear manifest.json (falta añadir en public/)
# Crear service worker
# Permitir instalación como app
```

**Beneficio:** Usuarios pueden instalar como app nativa en sus escritorios.

### 14. Tests E2E con Playwright
```bash
npm install -D @playwright/test
npm run test:e2e
```

Simularía flujos completos de usuario automaticamente.

### 15. Dominio personalizado
```
inventario.arles.com
```

Configurar en Firebase Hosting.

### 16. Monitorización
- Firebase Performance Monitoring
- Google Analytics
- Error Reporting

### 17. CI/CD
GitHub Actions para desplegar automáticamente en cada push.

---

## 📋 Comandos útiles

```bash
# Desarrollo local
npm run dev

# Build producción
npm run build

# Previsualizar producción
npm run preview

# Tests unitarios
npm test

# Tests de Firestore Rules (requiere emulador)
firebase emulators:start --only firestore
npm run test:rules

# Desplegar todo
firebase deploy

# Solo Firestore Rules
firebase deploy --only firestore:rules

# Solo Hosting (después del build)
firebase deploy --only hosting
```

---

## 🔍 Checklist de validación final

Marca cada punto DESPUÉS de comprobarlo:

### Instalación y Build
- [ ] `.env.local` contiene credenciales reales
- [ ] `npm install` completa sin errores
- [ ] `npm test` pasa todos los tests
- [ ] `npm run build` genera `dist/`
- [ ] `npm run preview` funciona localmente

### Login y Autenticación
- [ ] Usuario válido puede hacer login
- [ ] Usuario bloqueado es rechazado
- [ ] Sesión persiste al recargar
- [ ] Logout funciona

### Funcionalidad Principal
- [ ] Inventario carga con datos reales
- [ ] Búsqueda/filtros funcionan
- [ ] Se puede crear una entrada
- [ ] Se puede crear una salida
- [ ] Historial muestra movimientos
- [ ] Excel exporta correctamente

### Firestore Rules
- [ ] `firebase.rules` tiene el email correcto del propietario
- [ ] Roles en `firestore.rules` coinciden con los reales
- [ ] Tests de reglas pasan (si ejecutas con emulador)

### Seguridad
- [ ] `.env.local` NO está en git (revisa `.gitignore`)
- [ ] API Key está restringida en Google Cloud
- [ ] App Check está configurado (si lo quisiste)

### Deployment (solo cuando TODO pase)
- [ ] `firebase deploy --only firestore:rules`
- [ ] `firebase deploy --only hosting`
- [ ] URL pública funciona
- [ ] Tests finales en URL pública

---

## Próximos pasos inmediatos

1. **HOY:** Actualizar `.env.local` con credenciales reales
2. **HOY:** Revisar roles en `firestore.rules`
3. **HOY:** `npm run preview` y probar flujo manual
4. **MAÑANA:** Desplegar Rules con `firebase deploy --only firestore:rules`
5. **MAÑANA:** Desplegar Hosting con `firebase deploy --only hosting`
6. **ESTA SEMANA:** Pruebas exhaustivas con usuarios reales
7. **PRÓXIMA SEMANA:** Monitorización en producción

---

## Contacto/Soporte

Para cambios futuros en las reglas o configuración, recuerda:

- `firestore.rules` - Lógica de seguridad
- `firebase.json` - Configuración de hosting
- `.env.local` - Credenciales locales (NO compartir)
- `src/` - Código de la aplicación React
- `vite.config.ts` - Configuración de build

Mantén los tests actualizados al cambiar las reglas.
