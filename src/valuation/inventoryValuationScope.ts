const TALLER_MODULE = 'TALLER';
const ASEO_HISTORICO_MODULE = 'ASEO HISTORICO';
const CONSUMIBLES_HISTORICO_MODULE = 'CONSUMIBLES HISTORICO';

function normalizeModuleName(moduleName: string) {
  return moduleName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function isInventoryValuationModuleIncluded(moduleName: string) {
  const normalizedModuleName = normalizeModuleName(moduleName);
  return normalizedModuleName !== TALLER_MODULE
    && !isHistoricalInventoryModule(moduleName);
}

export function isAseoHistoricoModule(moduleName: string) {
  return normalizeModuleName(moduleName) === ASEO_HISTORICO_MODULE;
}

export function isHistoricalInventoryModule(moduleName: string) {
  const normalizedModuleName = normalizeModuleName(moduleName);
  return normalizedModuleName === ASEO_HISTORICO_MODULE
    || normalizedModuleName === CONSUMIBLES_HISTORICO_MODULE;
}
