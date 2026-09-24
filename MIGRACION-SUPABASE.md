# Migrar la web existente a Supabase

## Alcance confirmado

Conservar la interfaz y funciones de la web actual: Consumibles, Agroquímicos, Aseo, Lubricantes, EPP, Dotación, Combustible, Taller/Herramientas, Indicadores, Valoración de Inventario, valoraciones de entradas, cierres mensuales, usuarios y exportaciones. La nueva app de Taller ya está instalada para revisión; su activación operativa continúa pendiente del cambio conjunto.

Se trabaja en un worktree aislado con los cambios actuales de src preservados. La web publicada sigue en Firebase. No se ha sustituido App.tsx ni publicado una interfaz nueva. La capa Supabase añadida todavía no está activada en producción.

## Fuente comprobada

Lectura consistente de Firestore arles-gestion: 2026-09-23T19:27:44.533656Z. Archivo privado e ignorado por Git en outputs/supabase-web, con SHA-256. 7.570 documentos de las colecciones y subcolecciones utilizadas por el panel, sin escrituras remotas.

| Fuente | Documentos |
|---|---:|
| Existencias | 838 |
| Aseo | 45 |
| Herramientas | 183 |
| Usuarios/perfiles | 8 |
| Movimientos principales | 1.658 |
| Valoraciones de inventario | 883 |
| Valoraciones de entradas | 57 |
| Cierres | 3 |
| Ítems de cierres | 2.646 |
| Movimientos congelados de cierres | 574 |
| Lotes agroquímicos | 90 |
| Asignaciones de entradas a lotes | 16 |

Incluye también historial_movimientos, historial_cambios y operaciones_inventario. Los movimientos de cierres son copias congeladas: no deben importarse como nuevas operaciones ni descontar stock. El historial principal aumentó en seis documentos respecto a la exportación móvil anterior; los seis pertenecen a Taller.

## Matriz de conservación y dependencias

| Función existente | Sustitución requerida |
|---|---|
| Inicio y persistencia | Supabase Auth, perfil activo; migración explícita de identidades, sin copiar contraseñas |
| Catálogo de siete módulos | products/stock_positions/lots; conservar códigos confirmados e identificar posiciones sin agrupar lotes por error |
| Movimientos | Archivo histórico y movimientos nuevos; agrupar recibos por event_id y conservar líneas para cálculo/exportación |
| Fotografías | Storage privado; evidencia por recibo, incluidas rutas legacy; nunca URL pública inventada |
| Taller/Herramientas | Estado, disponible/ocupado/total, QR, responsable, préstamos, devoluciones, submódulos y mantenimiento |
| Cambio de bodega agroquímica | RPC con valor esperado y validación; no alterar códigos ni duplicar saldo |
| Registrar/asignar lote | Operación atómica con UUID; conservar diferencia entre saldo existente asignado y entrada nueva |
| Valoración manual | Valor original, revisión concurrente y autor; equivalencia de legacy_id y valuationId |
| Valorar entradas | Promedio ponderado, orden de entradas pendientes y stock anterior/nuevo verificables |
| Cierres y reconstrucción | Intentos, bloqueo, recuperación tras 15 minutos, verificación de totales/IDs, snapshots históricos y confirmaciones existentes |
| Usuarios | Vinculación Firebase UID → Supabase UID; conservar auditorías históricas; roles/activación validados en servidor |
| Indicadores y Excel | Mantener fórmulas, filtros, fechas, plantillas y clasificación sin movimientos; probar con ambos contratos |
| Actualización y errores | Sustituir listeners por consultas/subscripciones Supabase, sin mostrar una descarga parcial como completa |

## Trabajo preparado

src/backend/supabase contiene contratos y lector para los RPC que usa la app Android. Mantiene separadas las posiciones de un producto, convierte cantidades milésimas sin redondear, pagina todos los módulos y rechaza cursores estancados, duplicados y salidas con líneas ajenas. El transporte acepta únicamente el proyecto esperado y funciones de lectura con token vigente; no reutiliza credenciales Firebase ni claves privilegiadas.

## Pendiente antes del cambio

Decisión confirmada: cambiar toda la web cuando también esté lista la nueva app de Taller. Mantener Firebase como origen de la web publicada y de Taller durante la preparación. No crear un puente temporal ni doble escritura. La copia exportada es una base de análisis, no el corte definitivo: repetir la reconciliación al cambio para incluir los movimientos posteriores.

Validación de esta preparación: 11 pruebas del lector/transporte Supabase aprobadas y TypeScript sin errores. No se ha activado el lector en la web ni cambiado la base de datos remota.

Faltan las tablas/RPC administrativas, migración verificable de datos y usuarios, integración del lector y Auth en la interfaz existente, fotografías privadas, reemplazo de escrituras y cierres, ajuste de CSP y validación autenticada completa. No retirar Firebase ni publicar hasta validar la paridad de todas las filas de esta matriz y reconciliar el corte final.

## Avance verificado — 23 de septiembre de 2026

Se aplicó `supabase/migrations/202609240001_web_admin_archive.sql` en el proyecto `gfgsnnweyfryfcqdnlvw`. Se preservaron 4.171 documentos administrativos de la lectura consistente `2026-09-23T21:11:31.672487Z`, fuente SHA-256 `35a33e67e122` (prefijo; manifiesto privado contiene el completo). La verificación remota devolvió `verified: true`, `stock_writes: 0`, `auth_changes: 0`.

- 883 valoraciones de inventario y 57 valoraciones de entradas.
- 3 cierres, 2.646 ítems y 574 movimientos congelados de cierres.
- 8 perfiles históricos; conservarlos **no crea cuentas ni concede permisos en Supabase Auth**.

Las tablas `web_admin_imports` y `web_admin_archive` tienen RLS habilitado y forzado, sin permisos para anon/authenticated. Contienen los documentos originales tipados y hashes SHA-256. No son aún las tablas operativas del panel. La función de verificación está reservada al administrador de la base. Los bloques se pueden reintentar sin duplicar documentos y la validación final rechaza diferencias, carga incompleta o detalles sin cierre.

Herramientas reproducibles: `scripts/supabase/prepare-admin-archive.mjs`, `admin-archive.mjs`, `verify-admin-archive.mjs`. Salidas privadas: `outputs/supabase-web/admin-35a33e67e122/`. La preparación usa bloques de 70 KB; en el editor se ejecutaron grupos de diez bloques, todos comprobados, y luego la verificación final de hashes y conteos.

También se añadió `src/backend/supabase/client.ts`: cliente con sesión persistente separada, renovación mediante SDK oficial, validación del proyecto/clave publicable, correo normalizado y descarga autenticada de evidencia del bucket privado. **Todavía no está conectado a App.tsx ni main.tsx**, y no se ha habilitado la web Supabase. No copia credenciales Firebase, no acepta claves privilegiadas y no genera URLs públicas de fotos.

Validación: PGlite comprobó igualdad exacta de 4.171 documentos, reintentos, rechazo de archivo incompleto/alterado y acceso denegado a anon/authenticated. Pasaron 14 pruebas Supabase. La suite general pasó 398 pruebas inicialmente; cuatro suites requerían variables de configuración Firebase y pasaron sus 23 pruebas al repetirlas con configuración ficticia `demo-arles-test` (sin credenciales reales). TypeScript y build Vite aprobados; persiste aviso de bundles grandes.

Siguiente trabajo obligatorio: enlazar identidades y valoraciones con productos/posiciones canónicos (incluidas bodegas y códigos renombrados), tablas y RPC operativos con concurrencia/auditoría, Supabase Auth en la interfaz existente, consultas completas de Taller y Almacén, fotos en la interfaz, cierres/valoraciones/usuarios/exportación y CSP. Reconciliar datos recientes al corte y probar las operaciones antes de activar Taller y sustituir la web publicada. La copia administrativa de hoy es una base verificada, **no el corte definitivo**.

## Valoración operativa preparada y comprobada — 23 de septiembre de 2026

Aplicadas remotamente `202609240002_web_valuations.sql` y `202609240003_web_existing_owner.sql`. Se promovieron los 883 precios del archivo verificado a `web_valuations`, conservando identificadores y campos originales. La promoción rechaza fuentes no verificadas y una segunda ejecución; no sobrescribe precios existentes.

Se vinculó únicamente el propietario ya existente de la web con su cuenta Supabase existente, comprobando UID/correo/estado contra la fuente y Auth. No se creó una cuenta ni se modificó la contraseña o el rol OPERATOR de la app móvil. Los otros siete perfiles históricos siguen sin otorgar acceso automáticamente.

La consulta `scripts/supabase/verify-web-valuations-remote.sql`, ejecutada como authenticated con la identidad del propietario y finalizada con rollback, comprobó:

- 1.052 posiciones/activos: 869 posiciones de Almacén y 183 activos de Taller.
- Las 869 posiciones de Almacén tienen precio enlazado; ninguna quedó sin vínculo de precio.
- Taller no tenía precios guardados en `valoraciones_inventario` (la fuente contiene 838 de existencias y 45 de aseo). Sus activos quedan sin valor asignado, con revisión 0.
- `web_panel_access()` devuelve el perfil verificado y `operational: false`.

Funciones disponibles: `web_panel_access`, `web_valuation_page`, `web_valuation_catalog` y `web_save_manual_valuation`. Esta última comprueba acceso, modo operativo, identidad canónica, revisión esperada y UUID de petición. Bloquea cambios concurrentes, admite reintentos idénticos sin duplicar auditorías y conserva antes/después/autor. Todas las tablas tienen RLS forzado, sin acceso directo de anon/authenticated. **Las escrituras reales siguen bloqueadas por web_settings.operational=false.**

`src/backend/supabase/administration.ts` contiene el cliente y la conversión al contrato `CurrentValuationRow` que ya utiliza la interfaz. Agrupa lotes del mismo producto/valoración sin duplicar su cantidad de productos; rechaza mezclas de productos, unidades o revisiones. Agroquímicos conserva la valoración independiente de cada bodega. Los códigos de pantalla actuales nunca se usan para adivinar una valoración antigua.

Pruebas: `scripts/supabase/verify-web-valuations.mjs` pasó con las 883 valoraciones reales: importación exacta, rechazo de reimportación, RLS/roles/desactivación, bloqueo en revisión, concurrencia, auditoría, reintento idempotente, rechazo de cantidades/precios inválidos, código renombrado y ambigüedad de bodega. Confirmó inventario intacto y cero movimientos creados. Pasaron 20 pruebas TypeScript de Supabase; TypeScript y build aprobados.

Pendiente: integrar estas consultas/operaciones con App.tsx y la sesión del navegador, y completar valoraciones de entradas, cierres, lotes, usuarios y demás lecturas/escrituras. Este avance no representa todavía un cambio de la interfaz publicada ni la activación operativa de Taller.

## Interfaz de valoraciones conectada — 24 de septiembre de 2026

`SupabaseValuations` reutiliza la tabla, filtros y modal de edición existentes. Consulta el catálogo completo mediante Supabase Auth y conecta el guardado manual con revisión esperada y UUID conservado durante reintentos. La sesión usa el cliente único del panel; cerrar sesión aquí no cierra la del teléfono. Los errores de acceso retiran los datos mostrados.

La revisión local se abre en `http://127.0.0.1:5174/?review=valuations` con `VITE_SUPABASE_VALUATIONS_REVIEW=true`; solo existe en desarrollo. También está disponible como pestaña de revisión del módulo actual. Esta vista no monta los listeners de AppShell ni consulta cierres Firebase. La política CSP admite el proyecto Supabase exacto. La configuración publicable permanece en `.env.local`, ignorado por Git.

El servidor mantiene `web_settings.operational=false`: permite consultar y abrir el editor, pero impide guardar hasta el cambio conjunto. No se ha publicado ni activado la nueva web. Las valoraciones de entradas y los cierres siguen pendientes de integración.

Validación: 38 pruebas aprobadas (ocho de interfaz, veinte de Supabase y diez de regresión), TypeScript y build Vite aprobados; persiste la advertencia de tamaño de bundles. Se comprobaron consulta, guardado simulado, reintento con el mismo UUID, conflicto concurrente, modo revisión, pérdida de sesión, desconexión y revocación de acceso. La comprobación visual con sesión real sigue pendiente: la pestaña observada aún muestra el formulario de acceso, sin errores de consola.


## Corte final 24 septiembre 2026
- Inicio de producción exclusivamente Supabase; los imports antiguos de Firebase fallan localmente si se invocan por error.
- Se conservan navegación, inventarios, historial, evidencias privadas, exportaciones, valoraciones, cierres y administración.
- Los permisos web no activan operadores móviles. Solicitud de cuenta y aprobación separadas.
- Cuatro préstamos recientes de Taller importados una sola vez, con sus tres fotografías (327124 bytes en total).
- Saldos de combustible confirmados directamente por el usuario: ACPM 517,69 y gasolina 112,71 gal. No volver a aplicar la conciliación anterior sobre ellos.
- Pruebas: 453 casos; un timeout de dependencias pasó en repetición aislada. Compilación y verify:release correctos, con advertencia de tamaño de chunks.
- Las reglas Firebase no se publican ni se cambian en este corte. Su emulador local no pudo arrancar por una instalación Java sin jvm.cfg.
- Reversión web: despliegue anterior en Vercel. No revertir saldos ni volver a ejecutar importaciones iniciales.
