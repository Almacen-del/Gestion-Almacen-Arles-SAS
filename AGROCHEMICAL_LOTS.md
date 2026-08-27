# Vencimientos de agroquímicos por lote

## Alcance de la web

La web registra y consulta fechas de vencimiento. No crea entradas, salidas ni modifica el saldo general del producto.

Cada lote se guarda de forma independiente en:

```text
existencias/{productoId}/lotes_agroquimicos/{LOTE__AAAA-MM-DD}
```

Campos del lote:

- `producto_id`
- `codigo_producto`
- `producto`
- `numero_lote`
- `fecha_vencimiento`
- `precision_vencimiento` (`dia` o `mes`)
- `fecha_ingreso`
- `cantidad_inicial`
- `cantidad_disponible`
- `asignaciones_entrada` (entrada móvil y cantidad incorporada a este lote)
- `unidad`
- `ubicacion`

El formulario impide asignar a lotes una cantidad superior al saldo del producto que todavía no tiene lote registrado. Un mismo producto puede tener varios documentos de lote con fechas diferentes.

## Avisos por correo

La integración opcional con Google Apps Script consulta los lotes una vez al día y agrupa
los avisos de 60, 30, 15 y 7 días. Los vencidos se notifican una sola vez por lote/destinatario.
No modifica existencias y necesita autorización y activación independientes de la web.
Ver [configuración, pruebas y estado de instalación](integrations/expiry-alerts/README.md).

## Entradas móviles pendientes

La web consulta los movimientos `entrada_stock` de Agroquímicos y compara su cantidad con lo ya asignado a lotes. Una entrada nueva aparece automáticamente como pendiente, sin modificar el movimiento original. Desde esa fila se registra el lote y su fecha de vencimiento; una entrada puede dividirse entre varios lotes.

El acumulado transaccional de cada entrada se conserva en:

```text
existencias/{productoId}/asignaciones_entradas_agroquimicos/{entradaId}
```

Esto evita asignar dos veces una misma cantidad, incluso si dos sesiones intentan guardar simultáneamente. La web no crea la entrada, no cambia el saldo general y no registra una salida.

Cuando la etiqueta solo informa mes y año, `fecha_vencimiento` se guarda como `AAAA-MM`. Para clasificación y FEFO se considera vigente hasta el último día de ese mes, sin inventar un día exacto en la visualización.

## Regla para la aplicación móvil

Las salidas deben usar FEFO: primero vence, primero sale.

1. Cargar los lotes del producto con `cantidad_disponible > 0`.
2. Separar los lotes vencidos; no proponerlos para despacho.
3. Ordenar los lotes vigentes por `fecha_vencimiento` ascendente y luego por `fecha_ingreso`.
4. Descontar la cantidad solicitada del primer lote; si no alcanza, continuar con el siguiente.
5. Actualizar los lotes y `existencias/{productoId}.cantidad` en una sola transacción.
6. Guardar en el movimiento móvil las asignaciones de lote utilizadas para conservar trazabilidad.

La función pura `allocateAgrochemicalExitFefo` en `src/agrochemicalLots.ts` define y prueba esa distribución, pero esta web no ejecuta el descuento.

## Relación con obsolescencia

- Lote vencido con existencias: bloqueado para salida y pendiente de revisión de obsolescencia.
- Lote a 30 días o menos: próximo a vencer.
- Lote con más de 30 días: vigente.
- Lote agotado: se conserva para trazabilidad, pero no participa en FEFO.
