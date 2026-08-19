# FASE 8 — Validación final y entrega

Versión final: `0.1.8-web-final`

## Objetivo
Cerrar la migración principal Electron → Web con una copia limpia, reversible y preparada para validación/build en el equipo del usuario.

## Verificaciones realizadas en este entorno
- Estructura fuente web presente (`src/`, `public/`, Vite, Firebase).
- `package.json`, `firebase.json` y archivos JSON auxiliares parsean correctamente.
- No quedan referencias runtime a `window.electronAPI`, `ipcRenderer`, `ipcMain`, `BrowserWindow` ni `showSaveDialog` dentro de `src/`.
- La exportación de movimientos utiliza la implementación web (`browserExcelExport.ts` + Blob/descarga).
- Firebase Authentication y Firestore continúan centralizados en `src/firebase.ts`.
- Firestore mantiene caché persistente multi-pestaña.
- Firebase Hosting apunta a `dist/` y mantiene rewrite SPA a `/index.html`.
- El despliegue de Hosting puede ejecutarse separado del despliegue de reglas.
- No se incluye `.env.local`, credenciales privadas, `node_modules`, `dist` antiguo ni artefactos Electron.

## Limitación de validación
No fue posible completar `npm ci` en este entorno por falta de acceso operativo al registro de npm. Por esa razón no se incluye un `dist/` nuevo y no se afirma que el build final haya sido ejecutado aquí.

Se intentó TypeScript con las dependencias incompletas y falló únicamente en resolución de paquetes/tipos ausentes (por ejemplo React/Node/Babel), lo cual no constituye una validación del código fuente.

## Validación definitiva en el PC
Ejecutar:

```bash
npm install
npm run verify:web
npm run preview
```

Y, para reglas Firestore antes de desplegarlas:

```bash
npm run test:rules
```

No desplegar reglas a producción hasta confirmar que los demás clientes que comparten Firestore son compatibles.

## Criterio de cierre
La migración principal queda estructuralmente terminada. La validación de aceptación final depende del build y pruebas funcionales ejecutados con dependencias completas en el equipo del usuario.
