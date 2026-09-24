/** Canonical database identities are kept independently of the codes shown in the existing UI. */
export const moduleNames = {
  CONSUMIBLES: 'Consumibles', AGROQUIMICOS: 'Agroquimicos', ASEO: 'ASEO',
  EPP: 'EPP', DOTACION: 'Dotación', COMBUSTIBLE: 'Combustible', LUBRICANTES: 'Lubricantes taller',
} as const;
export type ModuleId = keyof typeof moduleNames;

export interface CatalogPosition {
  position_id: string; product_id: string; module_id: ModuleId;
  code: string; name: string; category: string; reference: string; unit_id: string;
  location_code: string; quantity_milli: number; lot: string | null; expiry: string | null;
}
export interface ConfirmedLine {
  event_id: string; position_id?: string; module_id: ModuleId; code: string;
  product_name: string; reference: string; unit_id: string; kind: 'ENTRADA' | 'SALIDA';
  quantity_milli: number; occurred_at: string; confirmed_at: string;
  details: Record<string, string>; operator_name: string; location_code: string; lot: string | null;
}
export interface ConfirmedReceipt extends ConfirmedLine { items?: ConfirmedLine[] }
export interface HistoricalRow {
  source_path: string; module_id: ModuleId; product_id: string | null;
  source_code: string; display_code: string; product_name: string; reference: string;
  kind_original: string; quantity: number | null; unit_original: string; date_original: string;
  occurred_at: string | null; source_date: string | null; operator_name: string; recipient: string;
  review_flags: string[]; evidence_path?: string | null; photo_status?: string | null;
  original_fields: Record<string, unknown>;
}
export interface RpcTransport {
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

export function quantityFromMilli(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999_999_999_999)
    throw new Error('Cantidad de Supabase no válida. No se puede presentar un saldo aproximado.');
  return value / 1000;
}
export function assertModule(value: string): asserts value is ModuleId {
  if (!Object.hasOwn(moduleNames, value)) throw new Error(`Módulo no reconocido: ${value}`);
}
