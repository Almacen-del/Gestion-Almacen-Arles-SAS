import type { MovimientoParaReporte } from './reporteMovimientosExcel';
import { destinationLotOf, UNKNOWN_DESTINATION_LOT } from './valuation/monthlyActivity';

export type FuelReportUsers = Record<string, { nombre: string; cargo: string; email: string }>;
export type FuelDeliveryRow = {
  id: string;
  kind: 'Entrada' | 'Salida';
  fuel: 'ACPM' | 'Gasolina';
  dateSerial: number;
  gallons: number;
  hourMeter: string;
  machinery: string;
  plate: string;
  labor: string;
  destination: string;
  receiver: string;
  deliverer: string;
  company: string;
  observations: string;
};

const normalized = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');

export function fuelTypeForReport(movement: MovimientoParaReporte): FuelDeliveryRow['fuel'] | null {
  if (normalized(movement.modulo) !== 'combustible') return null;
  // Product identity only: never classify from a task/note mentioning fuel.
  for (const value of [movement.referencia, movement.descripcion]) {
    const key = normalized(value).replace(/^liquidos?\s*[-:·]?\s*/, '');
    if (key === 'acpm') return 'ACPM';
    if (key === 'gasolina') return 'Gasolina';
  }
  return null;
}

export function fuelRecipientCompany(value: string) {
  const companies = [...value.matchAll(/\(\s*empresa\s+([^()]+)\)/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  if (new Set(companies.map(normalized)).size > 1) {
    throw new Error('El solicitante indica más de una empresa. Corrige ese dato antes de exportar.');
  }
  return {
    recipient: value.replace(/\(\s*empresa\s+[^()]*\)/gi, '').replace(/\s+/g, ' ').trim(),
    company: companies[0] || 'ARLES SAS',
  };
}

function profileName(raw: string, users: FuelReportUsers): string {
  const value = raw.trim();
  if (!value) return '';
  const byId = users[value];
  if (byId) return byId.nombre || byId.email;
  const key = normalized(value);
  const matches = Object.values(users).filter(profile => {
    const first = profile.nombre.trim().split(/\s+/)[0];
    return [profile.email, profile.nombre, `${first} (${profile.cargo})`]
      .filter(Boolean).some(alias => normalized(alias) === key);
  });
  // Old Android entries store "first name (position)", not a UID.
  // Only expand an unambiguous exact alias; never infer an account from its role.
  if (matches.length === 1) return matches[0].nombre || matches[0].email;
  if (/^[A-Za-z0-9_-]{20,128}$/.test(value)) {
    throw new Error(`No se encontró el perfil del usuario ${value}; no se sustituirá por quien exporta.`);
  }
  return value;
}

export function fuelDateSerial(raw: string): number {
  let key = raw.trim();
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(key)) {
    const date = new Date(key);
    if (!Number.isFinite(date.getTime())) throw new Error(`Fecha de combustible inválida: ${raw}`);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    key = `${part('year')}-${part('month')}-${part('day')}`;
  }
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T,])/.exec(key);
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:$|[ T,])/.exec(key);
  const [year, month, day] = iso ? iso.slice(1).map(Number) : dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : [0, 0, 0];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Fecha de combustible inválida: ${raw || 'sin fecha'}`);
  }
  return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

export function createFuelDeliveryRows(movements: readonly MovimientoParaReporte[], users: FuelReportUsers): FuelDeliveryRow[] {
  const rows: FuelDeliveryRow[] = [];
  for (const movement of movements) {
    const fuel = fuelTypeForReport(movement);
    if (!fuel) continue;
    const type = normalized(movement.tipo);
    const entry = /\b(?:entrada|ingreso)\b/.test(type);
    const exit = /\b(?:salida|entrega|consumo|traslado)\b/.test(type);
    if (entry === exit) throw new Error(`El movimiento ${movement.id} no distingue entrada de salida.`);
    if (!Number.isFinite(movement.cantidad) || movement.cantidad <= 0) throw new Error(`Cantidad inválida en el movimiento ${movement.id}.`);
    if (!/^(?:galon(?:es)?|gal|gl|glns?)\.?$/.test(normalized(movement.unidad))) {
      throw new Error(`El movimiento ${movement.id} está en ${movement.unidad || 'unidad desconocida'}, no en galones. No se convertirá sin confirmar la unidad.`);
    }
    const { recipient, company } = fuelRecipientCompany(movement.solicitante);
    const actor = profileName(movement.usuarioUid || movement.usuario, users);
    const receiver = entry ? (actor || profileName(recipient, users)) : profileName(recipient, users);
    const destination = entry ? '' : destinationLotOf({
      id: movement.id, module: movement.modulo, type: movement.tipo, code: movement.codigo,
      name: movement.descripcion, reference: movement.referencia, quantity: movement.cantidad,
      occurredAt: movement.fecha, destinationLot: movement.destinationLot,
      observations: movement.observaciones, zone: movement.zona, labor: movement.labor,
      front: movement.frente, recipientName: receiver, machinery: movement.maquinaria,
    });
    rows.push({
      id: movement.id, kind: entry ? 'Entrada' : 'Salida', fuel,
      dateSerial: fuelDateSerial(movement.monthlyOccurredAt || movement.fecha), gallons: movement.cantidad,
      hourMeter: movement.horometro || '', machinery: movement.maquinaria || '',
      plate: movement.placaSerial || '', labor: movement.labor || movement.frente || '',
      destination: destination === UNKNOWN_DESTINATION_LOT ? '' : destination,
      receiver,
      // Entry form has no supplier in older mobile records. Leave blank, do not invent.
      deliverer: entry ? profileName(movement.proveedor || movement.entregaEntrada || '', users) : actor,
      company, observations: entry ? 'Entrada' : movement.observaciones,
    });
  }
  return rows.sort((a, b) => a.dateSerial - b.dateSerial || a.id.localeCompare(b.id));
}
