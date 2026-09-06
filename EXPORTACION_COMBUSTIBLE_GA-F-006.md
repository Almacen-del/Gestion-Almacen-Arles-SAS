# Exportación de combustible GA-F-006

Implementación del 6 de septiembre de 2026. Publicación web autorizada por el usuario; sin escrituras de datos en Firestore. La evidencia de validación y despliegue se conserva localmente en `outputs/fuel-publication-20260906/`.

## Formato autorizado

Se utiliza el archivo original `GA-F-006 Control y Seguimiento de Entrega de Combustible.xlsx`, versión 002 del 7/01/2026. Copia de distribución: `public/templates/GA-F-006-combustible-v002.xlsx`.

SHA-256 del original y de la copia: `63f98bb487ec4d63c4a052241e680114e48cbc16ca2e8c4cbfd37004870a04fe`.

Se mantienen las dos hojas, encabezados, logo, colores, fuentes, anchos, combinaciones, firmas, leyendas y configuración de página. La hoja COMBUSTIBLE contiene entradas y salidas juntas. La tabla crece por encima de 20 movimientos, repitiendo las filas de la propia plantilla; el pie se desplaza. Las celdas de texto permiten salto de línea y la altura crece cuando se necesita para leerlas. Al imprimir se repiten las cuatro filas de encabezado y el área impresa termina en el pie del formulario.

No se reconstruye el libro: se conservan todos sus componentes nativos y se modifican solamente los datos/rangos de COMBUSTIBLE, los formatos numéricos/saltos de línea necesarios y el área de impresión. La hoja CONTROL DE CAMBIOS y la imagen permanecen idénticas, byte por byte dentro del archivo.

## Correspondencia de columnas

| Columna | Dato exportado |
| --- | --- |
| ITEM | Consecutivo, sin reiniciar al superar 20 movimientos. |
| FECHA | Fecha guardada del movimiento; fecha nativa de Excel en día/mes/año. Los timestamps con zona se interpretan en Colombia. No se usa la fecha de exportación. |
| ACP | X cuando el producto es ACPM. |
| GSLN | X cuando el producto es gasolina. |
| GL | Cantidad del movimiento en galones, como número sin redondeo impuesto. |
| HORÓMETRO | Lectura guardada; vacío si falta. |
| MAQUINARIA | Maquinaria/equipo guardado. |
| PLACA/SERIAL | Campo explícito de placa o serial; no se deduce de un nombre como Tractor 3. |
| LABOR | Labor o frente guardado. |
| LOTE | Destino del consumo: campo explícito y reglas ya confirmadas del gasto mensual. No se toma el lote de fabricación ni la ubicación física del combustible. Vacío si no se reconoce. |
| QUIEN RECIBE | Salidas: solicitante, quitando únicamente la indicación de empresa. Entradas: usuario que registró el ingreso; solicitante como respaldo si no existe autor. |
| QUIEN ENTREGA | Salidas: autor guardado del movimiento, resuelto con su perfil de Firestore. Entradas: proveedor/entregador explícito, si se guardó. |
| EMPRESA A/C | ARLES SAS por defecto; se reemplaza solamente con `(empresa Nombre)` en el solicitante. |
| OBSERVACIONES | Salidas: observaciones originales, sin el resumen del exportador general. Entradas: `Entrada`, según aclaración del usuario. |

Los totales del pie suman **solo salidas** de cada combustible. Sus fórmulas y resultados se incluyen en las celdas libres bajo los rótulos originales. Las entradas no incrementan esos totales de entrega. Se conserva la leyenda original de galones/kilómetros como texto del formulario; no se implementa ninguna regla de cálculo a partir de ella.

## Trazabilidad y límites

- Se usa el historial completo confirmado por servidor y los filtros activos del módulo.
- Se consultan perfiles de usuarios por servidor al exportar. No se utiliza el usuario de la sesión exportadora para sustituir al autor de otra salida.
- Los registros antiguos pueden guardar `primer nombre (cargo)` en lugar de UID: solo se amplía al nombre completo cuando el alias coincide con un único perfil. Si no coincide, se mantiene el texto guardado, sin inferir identidades por cargo.
- Un UID sin perfil reconocible genera un aviso; no se suplanta por otro usuario. Datos históricos ausentes quedan vacíos.
- En las entradas antiguas de Android no se guarda un proveedor: se deja QUIEN ENTREGA vacío. Tampoco se inventan placas, horómetros, autorizaciones o cargos de firma.
- Solo se incluyen ACPM y gasolina del módulo Combustible. No se incluyen Urea/AdBlue, lubricantes ni equipos que mencionen combustible en sus notas.
- Una cantidad inválida, fecha imposible o unidad distinta de galones detiene la exportación con un mensaje. No se transforma litros a galones sin una definición confirmada.
- No se crean ni modifican movimientos, existencias, usuarios o reglas de seguridad.
- Los demás módulos mantienen su exportación anterior.

## Verificación

- Pruebas de columnas, identidades, compañía explícita, fechas de Colombia, unidades y separación de entradas/salidas.
- Tablas de 20, 21, 22 y 47 movimientos, sin pérdida de datos ni sobrescritura del pie.
- Comparación binaria de todas las partes nativas ajenas a los cambios autorizados, incluida la hoja de control y el logo.
- Descarga real en Chrome aislado con 25 movimientos de prueba, sin solicitudes a servicios externos ni escrituras de Firestore.
- Suite general: 375 pruebas aprobadas y compilación/verificación del artefacto correctas. Ensayos específicos del formato repetidos tras los ajustes visuales del pie.
- Evidencia local en `outputs/fuel-form-20260906/`. Los nombres y movimientos de los ensayos son ficticios; no se importaron al inventario.

Una primera ejecución general agotó el tiempo de carga en frío del test preexistente de dependencias Admin. La repetición pasó sin modificar esa prueba ni aumentar su límite.
