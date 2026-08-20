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
- `fecha_ingreso`
- `cantidad_inicial`
- `cantidad_disponible`
- `unidad`
- `ubicacion`

El formulario impide asignar a lotes una cantidad superior al saldo del producto que todavía no tiene lote registrado. Un mismo producto puede tener varios documentos de lote con fechas diferentes.

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
