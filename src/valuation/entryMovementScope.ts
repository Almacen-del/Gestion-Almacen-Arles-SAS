function normalizeEntryText(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()
    : '';
}

function startsWithExcludedOperation(value: string) {
  return ['devolucion', 'retorno', 'traslado'].some((term) => (
    value === term
    || value.startsWith(`${term} `)
    || value.startsWith(`${term}:`)
    || value.startsWith(`${term} -`)
  ));
}

export function isExcludedEntryStockMovement(data: Record<string, unknown>) {
  const description = ['tipoMovimiento', 'tipo', 'clase', 'origen_movimiento']
    .map((key) => normalizeEntryText(data[key]))
    .join(' ');
  const hasExcludedType = ['salida', 'devolucion', 'retorno', 'traslado']
    .some((term) => description.includes(term));
  const hasExcludedObservation = startsWithExcludedOperation(
    normalizeEntryText(data.observaciones),
  );
  const hasExcludedFlag = [
    'es_devolucion',
    'es_retorno',
    'es_traslado',
    'movimiento_entre_ubicaciones',
  ].some((key) => data[key] === true);
  const movesBetweenLocations = Boolean(
    normalizeEntryText(data.ubicacion_origen)
    && normalizeEntryText(data.ubicacion_destino),
  );
  return hasExcludedType
    || hasExcludedObservation
    || hasExcludedFlag
    || movesBetweenLocations;
}
