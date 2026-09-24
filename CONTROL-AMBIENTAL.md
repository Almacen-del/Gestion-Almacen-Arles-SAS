# Control de temperatura y humedad

Implementación local en la versión Supabase del panel. En Agroquímicos, el botón **Temperatura y humedad** abre una ventana con las últimas 500 mediciones confirmadas de todas las ubicaciones o de la seleccionada. Muestra responsable, fecha/hora de Colombia, temperatura, humedad y observaciones. Se actualiza cada 30 segundos y manualmente. Si falla la consulta o se revoca el acceso, retira los resultados anteriores.

La captura está en la aplicación nueva `C:/Users/Almacen/AndroidStudioProjects/ControlAmbientalArles`. La web consulta; la app registra manualmente. No existe integración nueva con Firebase.

## Base de datos

Migración: `supabase/migrations/202609240014_agrochemical_climate.sql`.

- Nueva tabla `agrochemical_climate_readings`, RLS forzado y sin permisos directos para anon/authenticated.
- `climate_record_reading`: únicamente operadores activos, validación en servidor, responsable derivado de Auth, fecha de recepción del servidor y UUID de captura para reintentos idempotentes. No permite actualizar ni borrar.
- `climate_readings_page`: requiere el acceso web existente; filtro de ubicación aplicado en servidor y máximo 500 filas por consulta.
- El control ambiental es independiente del indicador operativo del inventario. No altera productos, existencias, movimientos, usuarios ni los permisos de otros módulos.
- No se definen rangos aceptables, alarmas ni conclusiones sobre conservación de productos.

## Verificación

```powershell
$env:PGLITE_MODULE = "$PWD/outputs/climate-tools/node_modules/@electric-sql/pglite/dist/index.js"
node scripts/supabase/verify-climate.mjs
npx vitest run src/ui/AgrochemicalClimateModal.test.tsx src/ui/SupabasePanelShell.test.tsx
npm run build
```

El script SQL necesita PGlite instalado en la ruta indicada o una ruta equivalente. Prueba rechazo anónimo, validaciones, reintento idéntico, conflicto de ID, suplantación de otro actor, revocación, filtros y bloqueo del acceso directo. Las pruebas usan datos ficticios en bases locales; no insertan datos en producción.

## Pendiente de publicación

La migración se entrega sin aplicar a la base remota. Debe verificarse el destino `gfgsnnweyfryfcqdnlvw`, aplicar esa única migración y publicar el panel Supabase tras autorizar la publicación. Luego comprobar el flujo Android → Supabase → web con una medición real autorizada. No publicar indiscriminadamente todos los cambios pendientes de esta carpeta de trabajo.

La compilación web mantiene las advertencias preexistentes de tamaño de bundles/importación mixta. La app utiliza una APK debug para revisión y conserva advertencias de compatibilidad futura de Gradle.
