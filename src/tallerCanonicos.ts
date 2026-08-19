export const TALLER_SUBMODULO_HERRAMIENTAS = 'HERRAMIENTAS TALLER';
export const TALLER_SUBMODULO_BODEGA_ROJA = 'BODEGA ROJA';
export const TIPO_MOV_TRASLADO = 'Traslado';
export const TIPO_MOV_INGRESO_BODEGA = 'Ingreso bodega';

export const TALLER_SUBMODULOS = [
  TALLER_SUBMODULO_HERRAMIENTAS,
  'EQUIPOS COSECHA',
  'HERRAMIENTAS MECANICAS',
  'VEHICULOS',
  'IMPLEMENTOS AGRICOLAS',
  TALLER_SUBMODULO_BODEGA_ROJA,
] as const;

export function submodulosTrasladoDestino() {
  return TALLER_SUBMODULOS.filter((entry) => !esBodegaRojaTaller(entry));
}

const ALIAS_SUBMODULOS: Record<string, string> = {
  'HERRAMIENTAS DE TALLER': TALLER_SUBMODULO_HERRAMIENTAS,
  'HERRAMIENTA TALLER': TALLER_SUBMODULO_HERRAMIENTAS,
  'HERRAMIENTAS TALLER': TALLER_SUBMODULO_HERRAMIENTAS,
  'EQUIPOS DE COSECHA': 'EQUIPOS COSECHA',
  'EQUIPOS POSCOSECHA': 'EQUIPOS COSECHA',
  'EQUIPO DE COSECHA': 'EQUIPOS COSECHA',
  'EQUIPO COSECHA': 'EQUIPOS COSECHA',
  'HERRAMIENTA MECANICA': 'HERRAMIENTAS MECANICAS',
  'HERRAMIENTAS MECANICA': 'HERRAMIENTAS MECANICAS',
  'HERRAMIENTAS MECANICAS': 'HERRAMIENTAS MECANICAS',
  'VEHICULO': 'VEHICULOS',
  'VEHICULOS E IMPLEMENTOS AGRICOLAS': 'VEHICULOS',
  'IMPLEMENTO AGRICOLA': 'IMPLEMENTOS AGRICOLAS',
  'IMPLEMENTOS AGRICOLA': 'IMPLEMENTOS AGRICOLAS',
  'IMPLEMENTOS AGRICOLAS': 'IMPLEMENTOS AGRICOLAS',
  'BODEGA ROJA': 'BODEGA ROJA',
};

function textoSinAcentos(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim();
}

export function normalizarSubmoduloTaller(raw: string) {
  const limpio = raw.trim();
  if (!limpio) return TALLER_SUBMODULO_HERRAMIENTAS;

  const exact = TALLER_SUBMODULOS.find((entry) => entry.toLowerCase() === limpio.toLowerCase());
  if (exact) return exact;

  const compacto = textoSinAcentos(limpio);
  if (ALIAS_SUBMODULOS[compacto]) return ALIAS_SUBMODULOS[compacto];

  const byCompact = TALLER_SUBMODULOS.find((entry) => textoSinAcentos(entry) === compacto);
  if (byCompact) return byCompact;

  const partial = TALLER_SUBMODULOS.find(
    (entry) => compacto.includes(textoSinAcentos(entry)) || textoSinAcentos(entry).includes(compacto),
  );
  if (partial) return partial;

  return limpio.toUpperCase();
}

export function esSubmoduloTaller(raw: string) {
  const normalizado = normalizarSubmoduloTaller(raw);
  return TALLER_SUBMODULOS.some((entry) => entry.toLowerCase() === normalizado.toLowerCase());
}

export function coincideSubmoduloTaller(valor: string, subModulo: string) {
  if (!subModulo.trim()) return true;
  return normalizarSubmoduloTaller(valor).toLowerCase() === normalizarSubmoduloTaller(subModulo).toLowerCase();
}

export function esBodegaRojaTaller(subModulo: string) {
  return coincideSubmoduloTaller(subModulo, TALLER_SUBMODULO_BODEGA_ROJA);
}

function normalizarTipoMovimiento(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function esTrasladoMovimiento(movimiento: { tipo: string }) {
  return normalizarTipoMovimiento(movimiento.tipo).includes('traslado');
}

export function esIngresoBodegaMovimiento(movimiento: { tipo: string; cargo?: string; labor?: string }) {
  const tipo = normalizarTipoMovimiento(movimiento.tipo);
  const detalle = normalizarTipoMovimiento(`${movimiento.cargo ?? ''} ${movimiento.labor ?? ''}`);
  return tipo.includes('ingreso bodega') || detalle.includes('producto nuevo');
}

export type MovimientoSubmoduloCampos = {
  submodulo?: string;
  submoduloOrigen?: string;
  maquinaria?: string;
  tipo: string;
  cargo?: string;
  labor?: string;
};

export function movimientoPerteneceSubmoduloTaller(
  movimiento: MovimientoSubmoduloCampos,
  subModulo: string,
) {
  if (!subModulo.trim()) return true;

  const origen = movimiento.submoduloOrigen ?? movimiento.maquinaria ?? '';
  const detalle = `${movimiento.cargo ?? ''} ${movimiento.labor ?? ''}`.toLowerCase();

  if (esBodegaRojaTaller(subModulo)) {
    return (
      coincideSubmoduloTaller(origen, subModulo) ||
      coincideSubmoduloTaller(movimiento.submodulo ?? '', subModulo) ||
      (
        esIngresoBodegaMovimiento(movimiento) &&
        (
          detalle.includes(`destino: ${TALLER_SUBMODULO_BODEGA_ROJA.toLowerCase()}`)
        )
      )
    );
  }

  return (
    coincideSubmoduloTaller(movimiento.submodulo ?? '', subModulo) ||
    detalle.includes(`destino: ${subModulo.toLowerCase()}`)
  );
}

export function esSalidaVistaTaller(movimiento: MovimientoSubmoduloCampos, subModulo: string) {
  const tipo = normalizarTipoMovimiento(movimiento.tipo);
  const esTraslado = esTrasladoMovimiento(movimiento);
  if (esBodegaRojaTaller(subModulo)) {
    return esTraslado || tipo.includes('salida') || tipo.includes('entrega') || tipo.includes('consumo');
  }
  if (esIngresoBodegaMovimiento(movimiento)) return false;
  if (esTraslado) {
    return !coincideSubmoduloTaller(movimiento.submodulo ?? '', subModulo);
  }
  return tipo.includes('salida') || tipo.includes('entrega') || tipo.includes('consumo');
}

export function esEntradaVistaTaller(movimiento: MovimientoSubmoduloCampos, subModulo: string) {
  const tipo = normalizarTipoMovimiento(movimiento.tipo);
  const esIngresoBodega = esIngresoBodegaMovimiento(movimiento);
  const esTraslado = esTrasladoMovimiento(movimiento);
  if (esBodegaRojaTaller(subModulo)) {
    return esIngresoBodega || tipo.includes('entrada') || (tipo.includes('ingreso') && !tipo.includes('bodega'));
  }
  if (esIngresoBodega) return false;
  if (esTraslado) {
    return coincideSubmoduloTaller(movimiento.submodulo ?? '', subModulo);
  }
  return tipo.includes('entrada') || (tipo.includes('ingreso') && !tipo.includes('bodega'));
}

export function etiquetasMovimientoTaller(subModulo: string) {
  if (esBodegaRojaTaller(subModulo)) {
    return {
      salidas: 'Salidas / traslados',
      entradas: 'Entradas / devoluciones',
      salidasContador: 'salidas',
      entradasContador: 'entradas',
      salidasEmpty: 'Sin prestamos ni traslados desde Bodega Roja',
      entradasEmpty: 'Sin devoluciones ni ingresos nuevos en Bodega Roja',
      flujo: 'Bodega de soporte: ingresa productos, traslada a submodulos y registra prestamos/devoluciones.',
    };
  }
  return {
    salidas: 'Salidas',
    entradas: 'Entradas',
    salidasContador: 'salidas',
    entradasContador: 'entradas',
    salidasEmpty: 'Sin salidas en este periodo',
    entradasEmpty: 'Sin entradas registradas',
    flujo: 'Préstamos temporales con salida y devolución desde la app Android.',
  };
}

export function etiquetaSubmoduloTaller(subModulo: string) {
  switch (normalizarSubmoduloTaller(subModulo)) {
    case TALLER_SUBMODULO_HERRAMIENTAS:
      return 'H. TALLER';
    case 'EQUIPOS COSECHA':
      return 'COSECHA';
    case 'HERRAMIENTAS MECANICAS':
      return 'MECANICAS';
    case 'VEHICULOS':
      return 'VEHICULOS';
    case 'IMPLEMENTOS AGRICOLAS':
      return 'IMPLEMENTOS';
    case TALLER_SUBMODULO_BODEGA_ROJA:
      return 'BODEGA ROJA';
    default:
      return subModulo.slice(0, 16);
  }
}

export function resolverSubmoduloDesdeCampos(fields: {
  submoduloTaller?: string;
  categoria?: string;
  ubicacion?: string;
  seccion?: string;
}) {
  const candidatos = [
    fields.submoduloTaller ?? '',
    fields.seccion ?? '',
    fields.categoria ?? '',
    fields.ubicacion ?? '',
  ];
  const encontrado = candidatos.find((value) => esSubmoduloTaller(value));
  if (encontrado) return normalizarSubmoduloTaller(encontrado);

  const fallback = fields.submoduloTaller || fields.seccion || fields.categoria || fields.ubicacion || '';
  return normalizarSubmoduloTaller(fallback);
}

export function extraerNumeroQr(codigo: string, codigoQr = '') {
  if (codigoQr.trim()) return codigoQr.trim().replace(/^qr-/i, '');
  const clean = codigo.trim().toUpperCase();
  if (clean.startsWith('QR-')) return clean.slice(3).replace(/\D/g, '');
  if (/^\d+$/.test(clean)) return clean;
  const match = clean.match(/\d+/);
  return match?.[0] ?? '';
}
