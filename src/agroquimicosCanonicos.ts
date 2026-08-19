export const AGROQUIMICOS_BODEGA_AZUL = 'BODEGA AZUL';
export const AGROQUIMICOS_COP = 'COP';
export const AGROQUIMICOS_PORTUGUESA = 'PORTUGUESA';

export const AGROQUIMICOS_UBICACIONES = [
  AGROQUIMICOS_BODEGA_AZUL,
  AGROQUIMICOS_COP,
  AGROQUIMICOS_PORTUGUESA,
] as const;

export type AgroquimicosUbicacion = (typeof AGROQUIMICOS_UBICACIONES)[number];

const ALIAS_UBICACIONES: Record<string, AgroquimicosUbicacion> = {
  'BODEGA AZUL': AGROQUIMICOS_BODEGA_AZUL,
  AZUL: AGROQUIMICOS_BODEGA_AZUL,
  COP: AGROQUIMICOS_COP,
  PORTUGUESA: AGROQUIMICOS_PORTUGUESA,
};

function textoSinAcentos(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
}

export function normalizarUbicacionAgroquimicos(raw: string) {
  const limpio = (raw ?? '').trim();
  if (!limpio) return '';

  const upper = limpio.toUpperCase();
  const exact = AGROQUIMICOS_UBICACIONES.find((entry) => entry === upper);
  if (exact) return exact;

  const compact = textoSinAcentos(limpio).replace(/\s+/g, ' ').trim();
  if (ALIAS_UBICACIONES[compact]) return ALIAS_UBICACIONES[compact];

  if (compact.includes('BODEGA') && compact.includes('AZUL')) return AGROQUIMICOS_BODEGA_AZUL;
  if (compact.includes('PORTUGUESA')) return AGROQUIMICOS_PORTUGUESA;
  if (compact === 'COP' || compact.includes('CENTRO DE OPERACION') || compact.includes('CENTRO OPERACION')) {
    return AGROQUIMICOS_COP;
  }

  return '';
}

export function coincideUbicacionAgroquimicos(itemUbicacion: string, filtro: string) {
  if (!filtro) return true;
  return normalizarUbicacionAgroquimicos(itemUbicacion) === filtro;
}

export function etiquetaUbicacionAgroquimicos(ubicacion: string) {
  switch (ubicacion) {
    case AGROQUIMICOS_BODEGA_AZUL:
      return 'Bodega azul';
    case AGROQUIMICOS_COP:
      return 'COP';
    case AGROQUIMICOS_PORTUGUESA:
      return 'Portuguesa';
    default:
      return ubicacion;
  }
}

export function movimientoPerteneceUbicacionAgroquimicos(
  movement: { ubicacion?: string; submodulo?: string; referencia?: string },
  filtro: string,
) {
  if (!filtro) return true;
  const candidatos = [movement.ubicacion, movement.submodulo, movement.referencia];
  return candidatos.some((entry) => normalizarUbicacionAgroquimicos(entry ?? '') === filtro);
}