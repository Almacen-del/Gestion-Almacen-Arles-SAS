# Publicación y diagnóstico del panel

## Destino único

Producción: https://gestion-almacen-arles-sas.vercel.app/

Repositorio: https://github.com/Almacen-del/Gestion-Almacen-Arles-SAS

La integración GitHub–Vercel publica `main`. Antes de autorizar el push:

1. Revisar `git status` y el diff exacto. No incluir `.env.local`, credenciales, `outputs`, copias de inventario ni cambios ajenos.
2. Ejecutar `npm ci`, `npm run verify:web` y `npm run test:rules` en un candidato aislado. Usar Node 22 o 24 soportado; Java 21 para el emulador. `npm ci` modifica `node_modules`: nunca hacerlo en un candidato con una unión compartida a otra carpeta de dependencias.
3. Probar la compilación con `npm run preview`: acceso, carga, errores de consola/CSP y conexión. Las pruebas automáticas no sustituyen una verificación autenticada autorizada.
4. Publicar solo el commit aprobado. Vercel ejecuta build y `verify:release`; no se despliega Firebase Hosting.
5. Esperar estado Production/success. Comprobar `/release.json`, la meta `arles-release` y el pie del panel contra el SHA de GitHub; verificar cabeceras HTTP en el dominio habitual.

Los comandos antiguos de despliegue web fallan con una explicación y no cambian nada. `firebase.json` solo declara reglas. Esto no apaga el Firebase Hosting antiguo: su retirada o redirección remota queda pendiente de autorización, preservando las rutas de Authentication que dependan de Firebase.

`release.json` solo contiene commit, identificador y hora de compilación; no incluye variables de entorno. En compilaciones locales, `-local` indica que el árbol puede tener cambios no confirmados: el SHA base no certifica esos cambios. En Vercel se exige su SHA de publicación.

## Cabeceras y caché

`vercel.json` es la fuente de la política HTTP. Vite preview la usa también y genera una CSP meta compatible para el HTML. `frame-ancestors 'none'` y `X-Frame-Options: DENY` se entregan como cabeceras. Las funciones actuales de `us-central1-arles-gestion.cloudfunctions.net`, Firebase Auth/Firestore y reCAPTCHA están permitidas; no se permite JavaScript arbitrario con `unsafe-eval`.

HTML, `release.json` y el worker de retiro deben revalidarse; únicamente `/assets/` con nombres hash tiene caché inmutable. La excepción para React Refresh/conexiones locales solo existe en desarrollo, no en el artefacto de producción.

## Web instalable retirada

Se retiraron el hook sin consumidores y el manifiesto con iconos inexistentes. Se conserva `/service-worker.js` como worker mínimo de retiro para clientes antiguos. No intercepta peticiones, no recarga pestañas, no instala cachés nuevos y se desregistra.

El inicio de la web también elimina exclusivamente los registros del worker original y las cuatro cachés con nombres exactos del código retirado. No elimina IndexedDB, sesión Firebase, inventario persistente ni cachés de otras aplicaciones. No cambia la aplicación Android. El panel web requiere internet para abrirse; esta etapa no añade trabajo offline ni modifica el comportamiento previo de persistencia de Firestore.

## Diagnósticos y privacidad

`setupGlobalErrorHandler` captura errores sin iniciar Firebase. `initializeMonitoring` se llama expresamente después de crear Firebase; no bloquea el arranque. El destino por defecto es local: hasta 50 errores/advertencias técnicos en memoria y `sessionStorage`, nunca mensajes, stacks, nombres, UID, correos, cantidades, URL o metadatos de negocio. Solo se elimina la clave antigua `app_error_logs`, que podía contener datos sin depurar.

El envío opcional a Firebase Analytics requiere `VITE_MONITORING_ENABLED=true`, `VITE_FIREBASE_APP_ID` y `VITE_FIREBASE_MEASUREMENT_ID`. No se han configurado en producción ni enviado eventos reales en esta etapa. No se envían eventos si Do Not Track está activo o falta configuración; navegadores incompatibles/fallos del SDK conservan el diagnóstico local.

Antes de habilitarlo, aprobar el tratamiento de datos del servicio (Analytics puede usar cookies/identificadores propios) y desactivar medición mejorada/captura automática no necesaria en el flujo de datos de Analytics. El código desactiva page_view inicial y señales publicitarias, fija los campos de página sin rutas personales y envía únicamente `app_diagnostic` con tipo, origen permitido, categoría y versión. Límite: 20 eventos por sesión y 10 en cola mientras inicia. El estado `remote` significa SDK configurado, no recepción garantizada.

Validación pendiente al habilitarlo: con autorización, generar un error sintético sin datos de negocio, comprobar recepción del evento y versión en Analytics, revisar solicitudes salientes, consentimiento y bloqueadores. Analytics no ofrece un emulador equivalente a Firestore: la recepción automatizada de esta etapa usa un SDK simulado, no certifica entrega real.

## Dependencias y reversión

Browserslist se actualizó dentro de su versión mayor. Los overrides `gaxios@6 → uuid 11.1.1` y `teeny-request@9 → uuid 11.1.1` corrigen su dependencia transitiva; se conserva el override previo de ExcelJS. No se bajó Firebase Admin a la versión 10 sugerida por `audit fix --force`. Las pruebas de compatibilidad usan un servidor HTTP local para multipart y crean clientes Admin sin leer/escribir recursos reales. Revisar estos overrides cuando los paquetes originales actualicen su dependencia.

Ante una regresión tras publicación: volver al despliegue Vercel anterior verificado con autorización, sin modificar datos ni reglas. No usar `git reset --hard`. Las eliminaciones locales del manifiesto/hook son recuperables en Git y en el respaldo de la etapa. Mantener la URL del worker de retiro evita volver a servir código inválido a clientes antiguos; valorar este punto antes de revertir toda la versión.

Referencias técnicas: [cabeceras Vercel](https://vercel.com/docs/project-configuration/vercel-json), [Firebase Analytics](https://firebase.google.com/docs/reference/js/analytics), [ciclo de service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [uuid 11.1.1](https://github.com/uuidjs/uuid/releases/tag/v11.1.1).
