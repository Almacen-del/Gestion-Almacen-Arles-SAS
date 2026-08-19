import { describe, expect, it } from 'vitest';
import {
  crearReporteMovimientos,
  type InventarioParaReporte,
  type MovimientoParaReporte,
} from './reporteMovimientosExcel';

function movimiento(
  id: string,
  tipo: string,
  cantidad: number,
  overrides: Partial<MovimientoParaReporte> = {},
): MovimientoParaReporte {
  return {
    id,
    modulo: 'Dotación',
    tipo,
    codigo: 'DOT-046',
    descripcion: 'BOTA DE CAUCHO PUNTA DE ACERO',
    referencia: 'Talla: 39',
    cantidad,
    unidad: 'Unidad',
    fecha: `2026-07-${id === 'entrada' ? '01' : '02'}`,
    solicitante: 'Usuario',
    cargo: '',
    usuario: '',
    observaciones: '',
    fotoUrl: '',
    ...overrides,
  };
}

function inventario(
  id: string,
  saldoActual: number,
  overrides: Partial<InventarioParaReporte> = {},
): InventarioParaReporte {
  return {
    id,
    modulo: 'Dotación',
    codigo: 'DOT-046',
    descripcion: 'BOTA DE CAUCHO PUNTA DE ACERO',
    referencia: 'Talla: 39',
    unidad: 'Unidad',
    saldo_actual: saldoActual,
    ...overrides,
  };
}

function crearReporte(
  movimientos: MovimientoParaReporte[],
  historialCompleto: MovimientoParaReporte[],
  inventarioActual: InventarioParaReporte[],
) {
  return crearReporteMovimientos({
    moduleName: 'Dotación',
    movimientos,
    historialCompleto,
    inventarioActual,
    usuarios: {},
    periodLabel: 'Histórico completo',
    exportDate: '27 de julio de 2026',
    generatedBy: 'pruebas',
    coverageLabel: 'Inventario real confirmado por servidor',
  });
}

describe('conciliación del reporte con el inventario real', () => {
  it('reconstruye el saldo inicial y termina en el saldo actual de Firestore', () => {
    const entrada = movimiento('entrada', 'Entrada', 2);
    const salida = movimiento('salida', 'Salida', 5);
    const reporte = crearReporte(
      [entrada, salida],
      [entrada, salida],
      [inventario('dot-046', 2)],
    );

    expect(reporte.movimientosGenerales.map((fila) => [
      fila.saldo_anterior,
      fila.saldo_nuevo,
    ])).toEqual([
      [5, 7],
      [7, 2],
    ]);
    expect(reporte.categorias[0].consolidated[0]).toMatchObject({
      total_entradas: 2,
      total_salidas: 5,
      variacion_neta: -3,
      saldo_inicial_reconstruido: 5,
      saldo_cierre_mostrado: 2,
      saldo_actual: 2,
      estado_conciliacion: 'Conciliado con inventario',
    });
  });

  it('usa el historial oculto para calcular saldos aunque el Excel muestre solo una salida', () => {
    const entrada = movimiento('entrada', 'Entrada', 2);
    const salida = movimiento('salida', 'Salida', 5);
    const reporte = crearReporte(
      [salida],
      [entrada, salida],
      [inventario('dot-046', 2)],
    );

    expect(reporte.movimientosGenerales[0]).toMatchObject({
      saldo_anterior: 7,
      saldo_nuevo: 2,
    });
    expect(reporte.categorias[0].consolidated[0]).toMatchObject({
      total_entradas: 0,
      total_salidas: 5,
      variacion_neta: -5,
      saldo_inicial_reconstruido: 7,
      saldo_cierre_mostrado: 2,
      saldo_actual: 2,
    });
    const consolidado = reporte.categorias[0].consolidated[0];
    expect(
      (consolidado.saldo_inicial_reconstruido ?? 0)
      + consolidado.total_entradas
      - consolidado.total_salidas,
    ).toBe(consolidado.saldo_actual);
  });

  it('incluye productos del inventario aunque no tengan movimientos', () => {
    const reporte = crearReporte([], [], [
      inventario('dot-050', 4, {
        codigo: 'DOT-050',
        descripcion: 'CAMISA',
        referencia: 'Talla: M',
      }),
    ]);

    expect(reporte.categorias[0].consolidated).toEqual([
      expect.objectContaining({
        codigo: 'DOT-050',
        saldo_inicial_reconstruido: 4,
        saldo_cierre_mostrado: 4,
        saldo_actual: 4,
        estado_conciliacion: 'Inventario sin movimientos',
      }),
    ]);
    expect(reporte.summary.productos_inventario).toBe(1);
    expect(reporte.summary.productos_con_observacion).toBe(1);
  });

  it('vincula un movimiento sin código solo cuando nombre y referencia son únicos', () => {
    const salida = movimiento('salida', 'Salida', 1, {
      codigo: 'Sin código',
      descripcion: 'BOTA MATERIAL CAÑA ALTA (Talla: 40)',
      referencia: 'Talla: 40',
    });
    const reporte = crearReporte(
      [salida],
      [salida],
      [inventario('dot-035', 0, {
        codigo: 'DOT-035',
        descripcion: 'BOTA MATERIAL CAÑA ALTA',
        referencia: 'Talla: 40',
      })],
    );

    expect(reporte.movimientosGenerales[0]).toMatchObject({
      saldo_anterior: 1,
      saldo_nuevo: 0,
      estado_conciliacion: 'Vinculado por nombre y referencia',
    });
    expect(reporte.categorias[0].consolidated[0].codigo).toBe('DOT-035');
  });

  it('no adivina cuando el mismo código identifica varios productos actuales', () => {
    const salida = movimiento('salida', 'Salida', 1);
    const reporte = crearReporte(
      [salida],
      [salida],
      [
        inventario('duplicado-a', 2),
        inventario('duplicado-b', 3, { descripcion: 'OTRA BOTA' }),
      ],
    );

    const filaMovimiento = reporte.categorias[0].consolidated.find(
      (fila) => fila.estado_conciliacion.includes('Código duplicado'),
    );
    expect(filaMovimiento).toMatchObject({
      codigo: 'DOT-046',
      saldo_actual: null,
      saldo_inicial_reconstruido: null,
    });
    expect(reporte.summary.productos_con_observacion).toBe(3);
  });

  it('reconoce códigos alternos sin reemplazar el código principal del inventario', () => {
    const salida = movimiento('salida', 'Salida', 1, { codigo: 'QR-046' });
    const reporte = crearReporte(
      [salida],
      [salida],
      [inventario('dot-046', 2, {
        codigo: 'DOT-046',
        codigos_alternos: ['QR-046'],
      })],
    );

    expect(reporte.movimientosGenerales[0]).toMatchObject({
      saldo_anterior: 3,
      saldo_nuevo: 2,
      estado_conciliacion: 'Conciliado con inventario',
    });
    expect(reporte.categorias[0].consolidated[0].codigo).toBe('DOT-046');
  });
});
