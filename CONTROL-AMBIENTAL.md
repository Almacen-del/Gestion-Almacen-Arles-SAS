# Control ambiental de Bodega Azul

En Agroquímicos → Temperatura y humedad, la web consulta las mediciones AM y PM por fecha de Colombia. La captura se realiza exclusivamente desde el celular; no se ofrece formulario de registro en el panel. La aplicación Android conserva su RPC original y comparte el mismo historial.

## Criterios y alcance

Las 49 fichas proceden de `Arles_Bodega_Azul_almacenamiento_4_por_hoja.pdf`, SHA256 `f783f6ee343d255008aa00f5e3f1831e27daf8418eb1352f3e130ae451b91cd8`. Cada producto conserva código, nombre, página, instrucciones y referencias HDS. No se modifica el PDF original.

- NEMACYL: máximo 32 °C y máximo 78 % HR (inclusive).
- YODOSAFER SL: 4–30 °C; humedad sin porcentaje.
- KUMULUS WG: máximo 40 °C; humedad sin porcentaje.
- STIMPLEX: la mención −15 °C permanece como texto de la ficha, pendiente de confirmar formulación. No se usa como límite validado.
- Parámetros sin rango numérico confirmado: objetivo interno provisional 5–30 °C y HR <60 %. El rango térmico es una selección operativa, NO un estándar de FAO/EPA. El 60 % es una referencia ambiental para humedad en edificios, NO un límite validado para conservación de agroquímicos. Los límites específicos tienen prioridad; no se añade un mínimo a una ficha que solo especifica máximo.

Fuentes generales consultadas el 24/09/2026:
- FAO, ambiente fresco, seco y ventilado: https://www.fao.org/4/v8966e/v8966e.htm
- EPA, humedad en edificios <60 %: https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home
- EPA, prioridad de instrucciones del producto: https://www.epa.gov/safepestcontrol/storing-pesticides-safely

Temperatura y humedad se evalúan de forma independiente en dos paneles, dos barras históricas y dos columnas de resultados. Una humedad fuera de criterio no cambia el estado de temperatura. Cada evaluación distingue fuera de criterio, dentro de límites de la ficha, dentro de referencia orientativa y criterio incompleto. Describe condiciones ambientales del catálogo del PDF, no daño ni certificación de calidad, ni confirma existencias físicas por lectura. Las advertencias de formulación permanecen visibles al desplegar cada producto.

## Historial y gráficos

Gráficos semanales (lunes–domingo) y mensuales, todos los productos o uno, temperatura y humedad separadas, mínimos/promedios/máximos y barras de condiciones por registro. Los puntos son mediciones reales; no se rellenan faltantes ni se interpolan intervalos mayores a 18 horas. Tabla con responsable, observaciones, fecha y evaluación.

Consulta al abrir, cambiar periodo o pulsar Actualizar registros; no recarga automática del formulario. Una falla transitoria conserva la consulta anterior con aviso; denegación de acceso la retira.

## Base de datos

`202609240014_agrochemical_climate.sql`: captura móvil y tabla original.
`202609240017_climate_dashboard.sql`: criterios versionados privados con RLS, trigger de asignación de versión, consulta por rango y captura web. Aplicada al proyecto `gfgsnnweyfryfcqdnlvw`.

Los criterios de cada versión no se pueden actualizar/borrar; añadir una nueva versión para cambios futuros. Cada captura nueva (web/Android) obtiene su versión del servidor. Las mediciones anteriores conservan versión nula y se rotulan evaluación retrospectiva. No hay API de editar/borrar mediciones. Guardado con UUID, validaciones y exclusión por fecha/turno; reintentos idénticos son idempotentes. Acceso web usa `web_require_access`; no otorga permisos de operador móvil.

## Verificación

- `npm exec vitest run -- src/backend/supabase/climate.test.ts src/ui/AgrochemicalClimateModal.test.tsx`
- Configurar `PGLITE_MODULE` a la instalación local y ejecutar `node scripts/supabase/verify-climate-dashboard.mjs`.
- `npm run build` y `npm run verify:release`.

Pruebas locales: permisos, roles, revocación, 49 códigos únicos, criterios históricos, compatibilidad Android, límites exactos, fechas Colombia, duplicados y reintentos. Verificación UI con lectura real existente; borradores de prueba no guardados. No se añaden mediciones ficticias en producción. Persisten advertencias preexistentes de tamaño de bundles/importación mixta.
