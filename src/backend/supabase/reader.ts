import { assertModule, quantityFromMilli, moduleNames, type CatalogPosition, type ConfirmedReceipt,
  type HistoricalRow, type RpcTransport } from './contracts';

function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row)))
    throw new Error('Respuesta de Supabase no válida. Se conserva la consulta anterior.');
  return value;
}
function string(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== 'string' || !row[key]) throw new Error(`Falta ${key} en la respuesta.`);
  return row[key];
}
function unique<T>(rows: T[], key: (row: T) => string) {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = key(row);
    if (ids.has(id)) throw new Error('La paginación repitió un registro. Actualiza para obtener una lectura completa.');
    ids.add(id);
  }
  return rows;
}
export class SupabaseWarehouseReader {
  constructor(private readonly rpc: RpcTransport) {}

  async catalog(signal?: AbortSignal): Promise<CatalogPosition[]> {
    const result: CatalogPosition[] = [];
    for (let offset = 0; ; offset += 200) {
      signal?.throwIfAborted();
      const page = array(await this.rpc.call('warehouse_catalog', { p_offset: offset }, signal));
      if (page.length > 200) throw new Error('Página de catálogo fuera de contrato.');
      for (const row of page) {
        string(row, 'position_id'); string(row, 'product_id');
        assertModule(string(row, 'module_id')); quantityFromMilli(row.quantity_milli as number);
        result.push(row as unknown as CatalogPosition);
      }
      if (page.length < 200) break;
    }
    return unique(result, row => row.position_id);
  }

  async confirmed(signal?: AbortSignal): Promise<ConfirmedReceipt[]> {
    const result: ConfirmedReceipt[] = [];
    let cursor: string | null = null;
    for (;;) {
      signal?.throwIfAborted();
      const page = array(await this.rpc.call('warehouse_confirmed_movements', { p_after: cursor }, signal));
      if (page.length > 100) throw new Error('Página de movimientos fuera de contrato.');
      for (const row of page) {
        const id = string(row, 'event_id');
        if (cursor !== null && id <= cursor) throw new Error('El cursor de movimientos no avanzó.');
        assertModule(string(row, 'module_id'));
        const items = row.items === undefined ? [row] : array(row.items);
        if (!items.length) throw new Error('Registro sin productos.');
        const positions = new Set<string>();
        for (const line of items) {
          if (line.event_id !== id || line.module_id !== row.module_id || line.kind !== row.kind)
            throw new Error('Líneas ajenas al registro de salida.');
          quantityFromMilli(line.quantity_milli as number);
          if ((line.quantity_milli as number) <= 0) throw new Error('Movimiento sin cantidad positiva.');
          if (items.length > 1) {
            const position = string(line, 'position_id');
            if (positions.has(position)) throw new Error('Producto repetido dentro de la salida.');
            positions.add(position);
          }
        }
        result.push(row as unknown as ConfirmedReceipt);
        cursor = id;
      }
      if (page.length < 100) break;
    }
    return unique(result, row => row.event_id);
  }

  async historical(signal?: AbortSignal): Promise<HistoricalRow[]> {
    const result: HistoricalRow[] = [];
    for (const module of Object.keys(moduleNames)) {
      for (let offset = 0; ; offset += 100) {
        signal?.throwIfAborted();
        const page = array(await this.rpc.call('warehouse_historical_movements', { p_module: module, p_offset: offset }, signal));
        if (page.length > 100) throw new Error('Página histórica fuera de contrato.');
        for (const row of page) {
          string(row, 'source_path');
          if (row.module_id !== module) throw new Error('Historial de un módulo distinto.');
          // Historical quantities and missing dates retain their original semantics; never replay stock.
          result.push(row as unknown as HistoricalRow);
        }
        if (page.length < 100) break;
      }
    }
    return unique(result, row => row.source_path);
  }
}
