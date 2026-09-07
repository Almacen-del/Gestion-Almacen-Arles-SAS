import { describe, expect, it } from 'vitest';
import { isAuditedAnnulment, isOperationalMovementVisible } from './movementVisibility';
import { filterAndSortMovementView, mergeMovementPages, movementPageHasMore, type MovementViewRecord } from './movementView';
import { crearReporteMovimientos } from './reporteMovimientosExcel';

const canceled = { anulado: true, cantidad: 0, anulacion_id: 'anulacion-AGRO-example' };
const filters = { search: '', dateFrom: '', dateTo: '', code: '', person: '', product: '',
  belongsToScope: () => true, personText: (m: MovementViewRecord) => m.solicitante };
function record(id: string, hidden = false): MovementViewRecord {
  return { id, modulo: 'Agroquímicos', tipo: hidden ? 'Ajuste por anulación' : 'Salida',
    codigo: 'AGRO-TEST', descripcion: 'Producto de prueba', referencia: 'AGRO-TEST',
    cantidad: hidden ? 0 : 25, unidad: 'GRAMO', fecha: '2026-08-28 13:30',
    solicitante: 'Prueba', cargo: '', usuario: '', observaciones: '', fotoUrl: '',
    hiddenFromOperationalHistory: hidden };
}
describe('anulaciones auditadas: visibilidad operativa', () => {
  it('solo reconoce anulación explícita, neutral y con constancia', () => {
    expect(isAuditedAnnulment(canceled)).toBe(true);
    for (const patch of [
      { anulado: false }, { anulado: 'true' }, { anulado: undefined },
      { cantidad: 460500 }, { cantidad: -1 }, { cantidad: '0' }, { cantidad: undefined },
      { anulacion_id: '' }, { anulacion_id: '  ' }, { anulacion_id: null },
    ]) expect(isAuditedAnnulment({ ...canceled, ...patch })).toBe(false);
    expect(isOperationalMovementVisible({})).toBe(true);
  });
  it('oculta también con búsquedas y conserva los registros fuente sin cambios', () => {
    const source = [record('anulada', true), record('real')];
    const before = structuredClone(source);
    expect(filterAndSortMovementView(source, filters).map(m => m.id)).toEqual(['real']);
    expect(filterAndSortMovementView(source, { ...filters, search: 'prueba' }).map(m => m.id)).toEqual(['real']);
    expect(source).toEqual(before);
  });
  it('el listener oculta una fila ya cargada y permite volver a mostrarla', () => {
    const current = [record('same')];
    const hiddenPage = mergeMovementPages(current, [record('same', true)]);
    expect(hiddenPage).toHaveLength(1);
    expect(filterAndSortMovementView(hiddenPage, filters)).toEqual([]);
    const restored = mergeMovementPages(hiddenPage, [record('same')]);
    expect(filterAndSortMovementView(restored, filters)).toHaveLength(1);
    expect(movementPageHasMore(250)).toBe(true); // cursor uses raw snapshot size
  });
  it('no reaparece al exportar todo el historial ni cambia el saldo real', () => {
    const source = [record('anulada', true), record('real')];
    const report = crearReporteMovimientos({
      moduleName: 'Agroquimicos', movimientos: source, historialCompleto: source,
      inventarioActual: [{ id: 'AGRO-TEST-COP', modulo: 'Agroquímicos', codigo: 'AGRO-TEST',
        descripcion: 'Producto de prueba', referencia: 'AGRO-TEST', unidad: 'GRAMO',
        ubicacion: 'COP', saldo_actual: 1000 }],
      usuarios: {}, periodLabel: 'Agosto', exportDate: '2026-09-07',
      generatedBy: 'test', coverageLabel: 'test',
    });
    expect(report.movimientosGenerales.map(m => [m.tipo_movimiento, m.cantidad])).toEqual([['Salida', 25]]);
    expect(report.summary.total_movimientos).toBe(1);
    expect(report.summary.cantidad_salidas).toBe(25);
    expect(report.categorias.flatMap(c => c.movimientos).map(m => [m.tipo_movimiento, m.cantidad])).toEqual([['Salida', 25]]);
    expect(report.categorias[0].consolidated[0].saldo_actual).toBe(1000);
    expect(source).toHaveLength(2);
  });
});
