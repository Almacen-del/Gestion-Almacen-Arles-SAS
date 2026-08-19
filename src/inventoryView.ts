export type InventoryViewRecord = {
  id: string;
  codigo: string;
  codigoQr?: string;
  descripcion: string;
  referencia: string;
  categoria: string;
  subcategoria?: string;
  ubicacion?: string;
  caracteristica?: string;
  unidad: string;
};

export function normalizeInventoryText(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function inventorySearchText(item: InventoryViewRecord) {
  return normalizeInventoryText([
    item.codigo,
    item.codigoQr,
    item.descripcion,
    item.referencia,
    item.categoria,
    item.subcategoria,
    item.ubicacion,
    item.caracteristica,
    item.unidad,
  ].filter(Boolean).join(' '));
}

function naturalCodeParts(value: string) {
  return value.match(/\d+|\D+/g) ?? [value];
}

export function compareInventoryCodes(left: string, right: string) {
  const a = naturalCodeParts(normalizeInventoryText(left));
  const b = naturalCodeParts(normalizeInventoryText(right));
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] === b[index]) continue;

    const aNumber = /^\d+$/.test(a[index]) ? Number(a[index]) : null;
    const bNumber = /^\d+$/.test(b[index]) ? Number(b[index]) : null;
    if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
      return aNumber - bNumber;
    }

    return a[index].localeCompare(b[index], 'es', { sensitivity: 'base' });
  }

  return 0;
}

export function filterAndSortInventoryView<T extends InventoryViewRecord>(
  inventory: readonly T[],
  search: string,
) {
  const query = normalizeInventoryText(search);
  const filtered = query
    ? inventory.filter((item) => inventorySearchText(item).includes(query))
    : [...inventory];

  return filtered.sort((left, right) => (
    compareInventoryCodes(left.codigoQr || left.codigo, right.codigoQr || right.codigo)
    || left.descripcion.localeCompare(right.descripcion, 'es', { sensitivity: 'base' })
    || left.referencia.localeCompare(right.referencia, 'es', { sensitivity: 'base' })
    || left.id.localeCompare(right.id)
  ));
}
