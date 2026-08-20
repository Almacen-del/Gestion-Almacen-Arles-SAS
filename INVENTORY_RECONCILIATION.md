# Conciliación de inventario histórico

## Objetivo

Conciliar ASEO y Consumibles históricos con sus fuentes activas antes de unificar los conteos de Valoración e Indicadores. El inventario objetivo excluye únicamente el módulo exacto `TALLER`.

## Regla principal

Los saldos históricos nunca se suman automáticamente al inventario activo. Una coincidencia única se propone como vínculo documental; una diferencia de saldo requiere evidencia y aprobación. Un producto que solo existe en histórico requiere conteo físico antes de promoverse.

## Ejecución segura

```bash
npm run audit:reconcile-inventory
```

El comando:

- usa la sesión ya autenticada de Firebase CLI;
- lee `existencias`, `productos_aseo` y `movimientos` mediante la API de Firestore;
- rechaza flags de escritura como `--apply`, `--write` o `--commit`;
- genera los resultados únicamente dentro de `outputs/`, carpeta excluida de Git;
- crea un respaldo local y un manifiesto SHA-256.

## Archivos generados

- `live-source-snapshot.json`: respaldo de las fuentes leídas.
- `summary.json`: conteos y alcance propuesto.
- `reconciliation.csv`: matriz revisable registro por registro.
- `reconciliation.json`: copia estructurada de la matriz generada.
- `movement-evidence.json`: movimientos vinculados a los históricos, sin exportar datos personales innecesarios.
- `REVIEW.md`: resumen para aprobación.
- `manifest.sha256.json`: hashes de integridad.

## Estados

- `same-stock`: coincidencia única y mismo saldo.
- `different-stock`: coincidencia única con saldo diferente; no sumar.
- `stock-missing`: falta una cantidad comparable.
- `historical-only`: candidato a promoción después de conteo físico.
- `historical-missing-code`: requiere asignación de código y revisión.
- `ambiguous-active-match`: más de una coincidencia; requiere decisión manual.

## Puerta antes de escribir

Ningún cambio remoto puede ejecutarse a partir de esta simulación sin:

1. revisión del CSV;
2. conteo físico de los históricos sin coincidencia;
3. aprobación de responsables;
4. respaldo verificado;
5. simulación final sin excepciones no aprobadas.

Después de completar en el CSV `physicalCount`, `physicalCountDate`, `verifiedBy`,
`approvedAction` y `evidenceReference`, la propuesta se valida sin escribir con:

```bash
npm run audit:simulate-inventory-migration -- --review=outputs/inventory-reconciliation-AAAA-MM-DD/reconciliation.csv
```

Las acciones permitidas son `promote-as-active` para un histórico independiente y
`keep-active-link-history` para una coincidencia que debe conservar un solo producto activo.
