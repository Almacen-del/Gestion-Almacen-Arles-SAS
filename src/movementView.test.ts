import { describe, expect, it } from 'vitest';
import {
  filterAndSortMovementView,
  loadedMovementHistoryCoversDate,
  mergeMovementPages,
  movementDisplayCount,
  nextMovementDisplayLimit,
  movementPageHasMore,
  shouldAutoLoadMovementPage,
  type MovementViewRecord,
} from './movementView';
import { crearReporteMovimientos } from './reporteMovimientosExcel';

type TestMovement = MovementViewRecord & { visibleModule: boolean };

function movement(
  id: string,
  overrides: Partial<TestMovement> = {},
): TestMovement {
  return {
    id,
    modulo: 'TALLER',
    tipo: 'Salida',
    codigo: `COD-${id}`,
    descripcion: `Producto ${id}`,
    referencia: 'Mecánica',
    cantidad: 1,
    unidad: 'Unidad',
    fecha: '2026-07-10',
    solicitante: 'Ana',
    cargo: 'Operadora',
    usuario: 'ana@example.com',
    observaciones: '',
    fotoUrl: '',
    submodulo: 'MECANICA Y AJUSTE',
    visibleModule: true,
    ...overrides,
  };
}

const baseFilters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  code: '',
  person: '',
  product: '',
  belongsToScope: (entry: TestMovement) => entry.visibleModule,
  personText: (entry: TestMovement) => `${entry.solicitante} ${entry.usuario}`,
};

describe('fuente única de movimientos', () => {
  it('excluye del Excel todos los registros ocultos por alcance, búsqueda y filtros', () => {
    const records = [
      movement('visible', {
        codigo: 'FIL-001',
        descripcion: 'Filtro de aceite',
        fecha: '2026-07-12',
        solicitante: 'Ana Pérez',
      }),
      movement('otro-modulo', { visibleModule: false, codigo: 'FIL-002', descripcion: 'Filtro de aceite' }),
      movement('otra-fecha', { codigo: 'FIL-003', descripcion: 'Filtro de aceite', fecha: '2026-06-01' }),
      movement('otra-persona', {
        codigo: 'FIL-004',
        descripcion: 'Filtro de aceite',
        solicitante: 'Carlos',
        usuario: 'carlos@example.com',
      }),
      movement('otro-producto', { codigo: 'ACE-001', descripcion: 'Aceite hidráulico' }),
    ];
    const visible = filterAndSortMovementView(records, {
      ...baseFilters,
      search: 'filtro',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      code: 'FIL',
      person: 'Ana',
      product: 'filtro de aceite',
    });
    const report = crearReporteMovimientos({
      moduleName: 'TALLER',
      tallerSubmodulo: 'MECANICA Y AJUSTE',
      movimientos: visible,
      usuarios: {},
      periodLabel: 'Julio 2026',
      exportDate: '13 de julio de 2026',
      generatedBy: 'pruebas',
      coverageLabel: 'Historial completo cargado',
    });

    expect(visible.map((entry) => entry.id)).toEqual(['visible']);
    expect(report.summary.total_movimientos).toBe(1);
    expect(report.movimientosGenerales.map((row) => row.codigo)).toEqual(['FIL-001']);
    expect(report.categorias.flatMap((category) => category.movimientos.map((row) => row.codigo)))
      .toEqual(['FIL-001']);
  });

  it('mantiene un orden estable sin mutar el arreglo recibido', () => {
    const records = [
      movement('b', { fecha: '2026-07-12' }),
      movement('a', { fecha: '2026-07-12' }),
      movement('c', { fecha: '2026-07-11' }),
    ];
    const original = [...records];

    const sorted = filterAndSortMovementView(records, baseFilters);
    const report = crearReporteMovimientos({
      moduleName: 'TALLER',
      tallerSubmodulo: 'MECANICA Y AJUSTE',
      movimientos: sorted,
      usuarios: {},
      periodLabel: 'Histórico completo',
      exportDate: '13 de julio de 2026',
      generatedBy: 'pruebas',
      coverageLabel: 'Historial completo cargado',
    });

    expect(sorted.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(report.movimientosGenerales.map((row) => row.codigo)).toEqual(['COD-a', 'COD-b', 'COD-c']);
    expect(records).toEqual(original);
  });

  it('deduplica páginas y detecta si puede existir otra página', () => {
    const merged = mergeMovementPages(
      [movement('a'), movement('b', { descripcion: 'Anterior' })],
      [movement('b', { descripcion: 'Actualizado' }), movement('c')],
    );

    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(merged.find((entry) => entry.id === 'b')?.descripcion).toBe('Actualizado');
    expect(movementPageHasMore(250, 250)).toBe(true);
    expect(movementPageHasMore(249, 250)).toBe(false);
  });

  it('muestra todos los resultados cuando hay filtros activos y pagina la vista normal', () => {
    expect(movementDisplayCount(55, 24, true)).toBe(55);
    expect(movementDisplayCount(55, 24, false)).toBe(24);
    expect(movementDisplayCount(10, 24, false)).toBe(10);
    expect(nextMovementDisplayLimit(24, 24)).toBe(48);
  });

  it('detecta si las páginas cargadas ya cubren la fecha inicial solicitada', () => {
    const records = [
      movement('reciente', { fecha: '2026-07-28 06:04' }),
      movement('antiguo', { fecha: '01/07/2026' }),
    ];

    expect(loadedMovementHistoryCoversDate(records, '2026-07-01')).toBe(true);
    expect(loadedMovementHistoryCoversDate(records, '2026-06-30')).toBe(false);
    expect(loadedMovementHistoryCoversDate(records, '')).toBe(false);
  });

  it('continúa automáticamente por bloques, incluso después de 1.000 movimientos cargados', () => {
    const baseState = {
      isOperationalModule: true,
      hasMoreMovements: true,
      isLoading: false,
      isOnline: true,
      isServerReady: true,
      hasError: false,
      isExporting: false,
    };

    let total = 250;
    for (const size of [250, 250, 250, 250, 37]) {
      expect(shouldAutoLoadMovementPage(baseState)).toBe(true);
      expect(shouldAutoLoadMovementPage({ ...baseState, isLoading: true })).toBe(false);
      total += size;
      baseState.hasMoreMovements = movementPageHasMore(size);
    }
    expect(total).toBe(1287);
    expect(shouldAutoLoadMovementPage(baseState)).toBe(false);
  });

  it.each([
    { isOperationalModule: false }, { hasMoreMovements: false },
    { isLoading: true }, { isOnline: false }, { isServerReady: false },
    { hasError: true }, { isExporting: true },
  ])('pausa la carga cuando no es seguro continuar: %j', (override) => {
    expect(shouldAutoLoadMovementPage({
      isOperationalModule: true, hasMoreMovements: true, isLoading: false,
      isOnline: true, isServerReady: true, hasError: false, isExporting: false,
      ...override,
    })).toBe(false);
  });

  it('reanuda al recuperar conexión o reintentar, sin marcar el módulo como intentado para siempre', () => {
    const state = {
      isOperationalModule: true, hasMoreMovements: true, isLoading: false,
      isOnline: false, isServerReady: false, hasError: true, isExporting: false,
    };
    expect(shouldAutoLoadMovementPage(state)).toBe(false);
    expect(shouldAutoLoadMovementPage({ ...state, isOnline: true, isServerReady: true })).toBe(false);
    expect(shouldAutoLoadMovementPage({ ...state, isOnline: true, isServerReady: true, hasError: false })).toBe(true);
  });
});
