import ExcelJS from 'exceljs';
import type { FilaMovimientoExcel, HojaCategoriaReporte, ReporteMovimientosPayload } from '../reporteMovimientosExcel';

type AnyWorkbook = ExcelJS.Workbook;
type AnyWorksheet = ExcelJS.Worksheet;

const COLUMNAS_MOVIMIENTOS = [
  'Fecha',
  'Tipo de movimiento',
  'Código',
  'Nombre del producto',
  'Submódulo',
  'Subcategoría',
  'Cantidad entrada',
  'Cantidad salida',
  'Unidad',
  'Saldo anterior',
  'Saldo nuevo',
  'Estado de conciliación',
  'Responsable',
  'Observación',
  'Documento soporte',
];

const COLUMNAS_CONSOLIDADO = [
  'Código',
  'Nombre del producto',
  'Submódulo',
  'Subcategoría',
  'Existencia inicial',
  'Entradas',
  'Salidas',
  'Existencia actual',
  'Unidad',
];

const TOTAL_COLUMNAS = COLUMNAS_MOVIMIENTOS.length;

const MARCA = {
  verde900: 'FF123F23',
  verde800: 'FF16532C',
  verde700: 'FF087B3B',
  verde100: 'FFE7F4E4',
  variante: 'FF144619',
  acento: 'FF1E6B52',
  texto: 'FF172118',
  muted: 'FF5A6E62',
  linea: 'FFC8DCC9',
};

const BORDE = {
  top: { style: 'thin', color: { argb: MARCA.linea } },
  left: { style: 'thin', color: { argb: MARCA.linea } },
  bottom: { style: 'thin', color: { argb: MARCA.linea } },
  right: { style: 'thin', color: { argb: MARCA.linea } },
};

const RELLENO_ENCABEZADO = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: MARCA.verde700 },
};

const RELLENO_TITULO = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: MARCA.verde100 },
};

const RELLENO_BANNER = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: MARCA.verde800 },
};

const RELLENO_META = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3FAF4' },
};

const RELLENO_ALTERNO = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3FAF4' },
};

const RELLENO_TOTALES = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: MARCA.verde100 },
};

const LOGO_REF_ANCHO = 1163;
const LOGO_REF_ALTO = 1279;
const LOGO_ALTO_OBJETIVO = 72;

function tamanoLogoProporcional(altoObjetivo = LOGO_ALTO_OBJETIVO) {
  const escala = altoObjetivo / LOGO_REF_ALTO;
  return {
    width: Math.round(LOGO_REF_ANCHO * escala),
    height: Math.round(LOGO_REF_ALTO * escala),
  };
}

function insertarLogoEncabezado(libro: AnyWorkbook, hoja: AnyWorksheet, logoBase64: string) {
  const tamano = tamanoLogoProporcional();
  hoja.mergeCells(1, 1, 5, 2);
  hoja.getColumn(1).width = 11;
  hoja.getColumn(2).width = 11;
  for (let fila = 1; fila <= 5; fila += 1) {
    hoja.getRow(fila).height = 16;
  }

  const imagenId = libro.addImage({ base64: logoBase64, extension: 'jpeg' });
  hoja.addImage(imagenId, {
    tl: { col: 0, row: 0, nativeCol: 0, nativeRow: 0, nativeColOff: 80000, nativeRowOff: 40000 },
    ext: tamano,
  });

  return tamano;
}

function ajustarColumnas(hoja: AnyWorksheet, columnas: string[], filaInicio: number, filaFin: number) {
  for (let col = 1; col <= columnas.length; col += 1) {
    let maximo = columnas[col - 1].length;
    for (let fila = filaInicio; fila <= filaFin; fila += 1) {
      const valor = hoja.getCell(fila, col).value;
      const texto = valor == null ? '' : String(valor);
      maximo = Math.max(maximo, texto.length);
    }
    hoja.getColumn(col).width = Math.min(Math.max(maximo + 2, 12), 52);
  }
}

function estiloEncabezado(hoja: AnyWorksheet, fila: number, totalColumnas: number) {
  for (let col = 1; col <= totalColumnas; col += 1) {
    const celda = hoja.getCell(fila, col);
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = RELLENO_ENCABEZADO as any;
    celda.border = BORDE as any;
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
  hoja.getRow(fila).height = 24;
}

function estiloCelda(celda: any, alterna: boolean, numerica = false) {
  celda.border = BORDE as any;
  celda.alignment = {
    vertical: 'middle',
    wrapText: true,
    horizontal: numerica ? 'right' : 'left',
  };
  if (alterna) celda.fill = RELLENO_ALTERNO as any;
}

function escribirEncabezadoCategoria(hoja: AnyWorksheet, categoria: any, totalColumnas = TOTAL_COLUMNAS) {
  hoja.mergeCells(1, 1, 1, totalColumnas);
  const titulo = hoja.getCell(1, 1);
  titulo.value = `ARLES S.A.S. · ${categoria.categoryLabel}`;
  titulo.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titulo.fill = RELLENO_BANNER as any;
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  hoja.getRow(1).height = 26;

  hoja.mergeCells(2, 1, 2, totalColumnas);
  const detalle = hoja.getCell(2, 1);
  detalle.value = [
    `Movimientos: ${categoria.summary?.total_movimientos ?? 0}`,
    `Entradas: ${categoria.summary?.total_entradas ?? 0}`,
    `Salidas: ${categoria.summary?.total_salidas ?? 0}`,
    `Cant. entrada: ${categoria.summary?.cantidad_entradas ?? 0}`,
    `Cant. salida: ${categoria.summary?.cantidad_salidas ?? 0}`,
  ].join('   |   ');
  detalle.alignment = { horizontal: 'center', vertical: 'middle' };
  detalle.font = { size: 10, color: { argb: MARCA.verde800 } };
  detalle.fill = RELLENO_TITULO as any;
  hoja.getRow(2).height = 20;

  return 4;
}

function escribirFilasMovimientos(hoja: AnyWorksheet, filas: FilaMovimientoExcel[], filaInicio: number) {
  filas.forEach((fila: FilaMovimientoExcel, indice: number) => {
    const numeroFila = filaInicio + indice;
    const valores = [
      fila.fecha,
      fila.tipo_movimiento,
      fila.codigo,
      fila.nombre_producto,
      fila.submodulo,
      fila.subcategoria,
      fila.cantidad_entrada,
      fila.cantidad_salida,
      fila.unidad,
      fila.saldo_anterior,
      fila.saldo_nuevo,
      fila.estado_conciliacion,
      fila.responsable,
      fila.observacion,
      fila.documento_soporte,
    ];
    const alterna = indice % 2 === 1;

    valores.forEach((valor, colIndex) => {
      const celda = hoja.getCell(numeroFila, colIndex + 1);
      celda.value = valor === '' ? null : valor;
      const numerica = colIndex >= 6 && colIndex <= 10;
      if (numerica) celda.numFmt = '#,##0.##';
      estiloCelda(celda, alterna, numerica);
      if (colIndex === 11 && String(valor).includes('Revisar')) {
        celda.font = { bold: true, color: { argb: 'FFC0392B' } };
      }
    });
  });

  return filaInicio + filas.length - 1;
}

function escribirTotalesMovimientos(hoja: AnyWorksheet, fila: number, filas: FilaMovimientoExcel[]) {
  const totales = filas.reduce(
    (acc: { entrada: number; salida: number }, filaActual: FilaMovimientoExcel) => ({
      entrada: acc.entrada + (filaActual.cantidad_entrada || 0),
      salida: acc.salida + (filaActual.cantidad_salida || 0),
    }),
    { entrada: 0, salida: 0 },
  );

  for (let col = 1; col <= TOTAL_COLUMNAS; col += 1) {
    const celda = hoja.getCell(fila, col);
    celda.border = BORDE as any;
    celda.fill = RELLENO_TOTALES as any;
    celda.font = { bold: true };
  }

  hoja.getCell(fila, 1).value = 'TOTALES';
  hoja.getCell(fila, 7).value = totales.entrada;
  hoja.getCell(fila, 7).numFmt = '#,##0.##';
  hoja.getCell(fila, 8).value = totales.salida;
  hoja.getCell(fila, 8).numFmt = '#,##0.##';
}

function crearHojaMovimientos(hoja: AnyWorksheet, categoria: any) {
  const filas = Array.isArray(categoria.movimientos) ? categoria.movimientos : [];
  const filaEncabezado = escribirEncabezadoCategoria(hoja, categoria);

  COLUMNAS_MOVIMIENTOS.forEach((titulo, index) => {
    hoja.getCell(filaEncabezado, index + 1).value = titulo;
  });
  estiloEncabezado(hoja, filaEncabezado, TOTAL_COLUMNAS);

  const filaFinDatos = filas.length > 0
    ? escribirFilasMovimientos(hoja, filas, filaEncabezado + 1)
    : filaEncabezado;

  const filaTotales = filaFinDatos + 1;
  escribirTotalesMovimientos(hoja, filaTotales, filas);

  if (filas.length > 0) {
    hoja.autoFilter = {
      from: { row: filaEncabezado, column: 1 },
      to: { row: filaFinDatos, column: TOTAL_COLUMNAS },
    };
  }
  hoja.views = [{ state: 'frozen', ySplit: filaEncabezado, activeCell: `A${filaEncabezado + 1}` }];
  ajustarColumnas(hoja, COLUMNAS_MOVIMIENTOS, filaEncabezado, filaTotales);
}

function crearHojaConsolidado(hoja: AnyWorksheet, categoria: any) {
  const filas = Array.isArray(categoria.consolidated) ? categoria.consolidated : [];
  const filaEncabezado = escribirEncabezadoCategoria(hoja, {
    ...categoria,
    categoryLabel: `${categoria.categoryLabel} · Consolidado`,
  }, COLUMNAS_CONSOLIDADO.length);

  COLUMNAS_CONSOLIDADO.forEach((titulo, index) => {
    hoja.getCell(filaEncabezado, index + 1).value = titulo;
  });
  estiloEncabezado(hoja, filaEncabezado, COLUMNAS_CONSOLIDADO.length);

  filas.forEach((fila: any, indice: number) => {
    const numeroFila = filaEncabezado + 1 + indice;
    const valores = [
      fila.codigo,
      fila.nombre_producto,
      fila.submodulo,
      fila.subcategoria,
      fila.saldo_inicial_reconstruido,
      fila.total_entradas,
      fila.total_salidas,
      fila.saldo_actual,
      fila.unidad,
    ];
    const alterna = indice % 2 === 1;

    valores.forEach((valor, colIndex) => {
      const celda = hoja.getCell(numeroFila, colIndex + 1);
      celda.value = valor;
      const numerica = colIndex >= 4 && colIndex <= 7;
      if (numerica) celda.numFmt = '#,##0.##';
      estiloCelda(celda, alterna, numerica);
    });
  });

  const filaFinDatos = filas.length > 0 ? filaEncabezado + filas.length : filaEncabezado;
  const filaTotales = filaFinDatos + 1;
  const totales = filas.reduce(
    (acc: { inicial: number; entrada: number; salida: number; actual: number }, fila: any) => ({
      inicial: acc.inicial + (fila.saldo_inicial_reconstruido || 0),
      entrada: acc.entrada + (fila.total_entradas || 0),
      salida: acc.salida + (fila.total_salidas || 0),
      actual: acc.actual + (fila.saldo_actual || 0),
    }),
    { inicial: 0, entrada: 0, salida: 0, actual: 0 },
  );

  for (let col = 1; col <= COLUMNAS_CONSOLIDADO.length; col += 1) {
    const celda = hoja.getCell(filaTotales, col);
    celda.border = BORDE as any;
    celda.fill = RELLENO_TOTALES as any;
    celda.font = { bold: true };
  }
  hoja.getCell(filaTotales, 1).value = 'TOTALES';
  hoja.getCell(filaTotales, 5).value = totales.inicial;
  hoja.getCell(filaTotales, 5).numFmt = '#,##0.##';
  hoja.getCell(filaTotales, 6).value = totales.entrada;
  hoja.getCell(filaTotales, 6).numFmt = '#,##0.##';
  hoja.getCell(filaTotales, 7).value = totales.salida;
  hoja.getCell(filaTotales, 7).numFmt = '#,##0.##';
  hoja.getCell(filaTotales, 8).value = totales.actual;
  hoja.getCell(filaTotales, 8).numFmt = '#,##0.##';

  if (filas.length > 0) {
    hoja.autoFilter = {
      from: { row: filaEncabezado, column: 1 },
      to: { row: filaFinDatos, column: COLUMNAS_CONSOLIDADO.length },
    };
  }
  hoja.views = [{ state: 'frozen', ySplit: filaEncabezado, activeCell: `A${filaEncabezado + 1}` }];
  ajustarColumnas(hoja, COLUMNAS_CONSOLIDADO, filaEncabezado, filaTotales);
}

function crearHojaResumen(libro: AnyWorkbook, hoja: AnyWorksheet, payload: ReporteMovimientosPayload, logoBase64?: string) {
  if (logoBase64) {
    insertarLogoEncabezado(libro, hoja, logoBase64);
  }

  hoja.getColumn(1).width = 34;
  hoja.getColumn(2).width = 16;
  hoja.getColumn(3).width = 16;
  hoja.getColumn(4).width = 23;
  hoja.getColumn(5).width = 42;
  hoja.getColumn(6).width = 18;

  hoja.mergeCells(1, 4, 1, 6);
  const banner = hoja.getCell(1, 4);
  banner.value = payload.companyName || 'ARLES S.A.S.';
  banner.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  banner.fill = RELLENO_BANNER as any;
  banner.alignment = { horizontal: 'left', vertical: 'middle' };
  hoja.getRow(1).height = 28;

  hoja.mergeCells(2, 4, 2, 6);
  const tituloReporte = hoja.getCell(2, 4);
  tituloReporte.value = payload.title || 'REPORTE DE MOVIMIENTOS DE INVENTARIO';
  tituloReporte.font = { bold: true, size: 13, color: { argb: MARCA.verde900 } };
  tituloReporte.fill = RELLENO_TITULO as any;
  tituloReporte.alignment = { horizontal: 'left', vertical: 'middle' };

  const meta = [
    ['Módulo', payload.moduleName || ''],
    ['Alcance', payload.moduleName ? `Inventario y movimientos de ${payload.moduleName}` : 'Módulo seleccionado'],
    ['Periodo', payload.periodLabel || 'Histórico completo'],
    ['Cobertura', payload.coverageLabel || 'Cobertura no informada'],
    ['Fecha de exportación', payload.exportDate || ''],
    ['Generado por', payload.generatedBy || ''],
  ];

  meta.forEach((fila, index) => {
    const numeroFila = index + 3;
    const etiqueta = hoja.getCell(numeroFila, 4);
    const valor = hoja.getCell(numeroFila, 5);
    etiqueta.value = fila[0];
    etiqueta.font = { bold: true, color: { argb: MARCA.verde800 } };
    etiqueta.fill = RELLENO_META as any;
    etiqueta.border = BORDE as any;
    valor.value = fila[1];
    valor.border = BORDE as any;
    valor.alignment = { vertical: 'middle', wrapText: true };
    if (index === 0) {
      valor.font = { bold: true, size: 12, color: { argb: MARCA.verde700 } };
    }
    hoja.getRow(numeroFila).height = 20;
  });

  const inicio = 12;
  hoja.mergeCells(inicio, 1, inicio, 6);
  const tituloResumen = hoja.getCell(inicio, 1);
  tituloResumen.value = 'Resumen general';
  tituloResumen.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  tituloResumen.fill = RELLENO_ENCABEZADO as any;
  tituloResumen.alignment = { horizontal: 'left', vertical: 'middle' };
  hoja.getRow(inicio).height = 22;

  const global = [
    ['Categorías incluidas', payload.summary?.total_categorias ?? 0],
    ['Total movimientos', payload.summary?.total_movimientos ?? 0],
    ['Registros de entradas', payload.summary?.total_entradas ?? 0],
    ['Registros de salidas', payload.summary?.total_salidas ?? 0],
    ['Cantidad total entradas', payload.summary?.cantidad_entradas ?? 0],
    ['Cantidad total salidas', payload.summary?.cantidad_salidas ?? 0],
    ['Productos del inventario real', payload.summary?.productos_inventario ?? 0],
    ['Productos con observación', payload.summary?.productos_con_observacion ?? 0],
  ];

  global.forEach((item, index) => {
    const numeroFila = inicio + 1 + index;
    const etiqueta = hoja.getCell(numeroFila, 1);
    const valor = hoja.getCell(numeroFila, 2);
    etiqueta.value = item[0];
    etiqueta.font = { bold: true, color: { argb: MARCA.verde800 } };
    etiqueta.fill = (index % 2 === 0 ? RELLENO_META : undefined) as any;
    valor.value = item[1];
    if (index >= 4) valor.numFmt = '#,##0.##';
    etiqueta.border = BORDE as any;
    valor.border = BORDE as any;
    if (index % 2 === 1) valor.fill = RELLENO_ALTERNO as any;
  });

  const inicioTabla = inicio + global.length + 3;
  const encabezados = ['Categoría', 'Movimientos', 'Entradas', 'Salidas', 'Cant. entrada', 'Cant. salida'];
  encabezados.forEach((titulo, index) => {
    hoja.getCell(inicioTabla, index + 1).value = titulo;
  });
  estiloEncabezado(hoja, inicioTabla, encabezados.length);

  const categorias = Array.isArray(payload.categorias) ? payload.categorias : [];
  categorias.forEach((categoria, index) => {
    const numeroFila = inicioTabla + 1 + index;
    const valores = [
      categoria.categoryLabel,
      categoria.summary?.total_movimientos ?? 0,
      categoria.summary?.total_entradas ?? 0,
      categoria.summary?.total_salidas ?? 0,
      categoria.summary?.cantidad_entradas ?? 0,
      categoria.summary?.cantidad_salidas ?? 0,
    ];
    valores.forEach((valor, colIndex) => {
      const celda = hoja.getCell(numeroFila, colIndex + 1);
      celda.value = valor;
      if (colIndex >= 4) celda.numFmt = '#,##0.##';
      estiloCelda(celda, index % 2 === 1, colIndex >= 1);
    });
  });

  const filaTotales = inicioTabla + categorias.length + 1;
  for (let col = 1; col <= encabezados.length; col += 1) {
    const celda = hoja.getCell(filaTotales, col);
    celda.border = BORDE as any;
    celda.fill = RELLENO_TOTALES as any;
    celda.font = { bold: true };
  }
  hoja.getCell(filaTotales, 1).value = 'TOTALES';
  hoja.getCell(filaTotales, 2).value = payload.summary?.total_movimientos ?? 0;
  hoja.getCell(filaTotales, 3).value = payload.summary?.total_entradas ?? 0;
  hoja.getCell(filaTotales, 4).value = payload.summary?.total_salidas ?? 0;
  hoja.getCell(filaTotales, 5).value = payload.summary?.cantidad_entradas ?? 0;
  hoja.getCell(filaTotales, 5).numFmt = '#,##0.##';
  hoja.getCell(filaTotales, 6).value = payload.summary?.cantidad_salidas ?? 0;
  hoja.getCell(filaTotales, 6).numFmt = '#,##0.##';

  if (categorias.length > 0) {
    hoja.autoFilter = {
      from: { row: inicioTabla, column: 1 },
      to: { row: inicioTabla + categorias.length, column: encabezados.length },
    };
  }
}

function combinarCategorias(categorias: HojaCategoriaReporte[]) {
  return {
    movimientos: categorias.flatMap((categoria) => categoria.movimientos || []),
    entradas: categorias.flatMap((categoria) => categoria.entradas || []),
    salidas: categorias.flatMap((categoria) => categoria.salidas || []),
    consolidated: categorias.flatMap((categoria) => categoria.consolidated || []),
  };
}



async function cargarLogoBase64(): Promise<string | undefined> {
  try {
    const response = await fetch('/logo-arles.jpeg', { cache: 'force-cache' });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function generarReporteMovimientosExcelWeb(payload: ReporteMovimientosPayload): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'ARLES S.A.S.';
  libro.created = new Date();

  const datos = payload;
  const logoBase64 = await cargarLogoBase64();
  const categorias = Array.isArray(datos.categorias) ? datos.categorias : [];
  const combinado = combinarCategorias(categorias);
  const modulo = datos.moduleName || 'Módulo';
  const contextoModulo = {
    categoryLabel: modulo,
    summary: datos.summary || {},
    movimientos: Array.isArray(datos.movimientosGenerales) ? datos.movimientosGenerales : combinado.movimientos,
    entradas: Array.isArray(datos.entradasGenerales) ? datos.entradasGenerales : combinado.entradas,
    salidas: Array.isArray(datos.salidasGenerales) ? datos.salidasGenerales : combinado.salidas,
    consolidated: combinado.consolidated,
  };

  crearHojaResumen(libro, libro.addWorksheet('Resumen'), datos, logoBase64);
  crearHojaMovimientos(libro.addWorksheet('Movimientos generales'), contextoModulo);
  crearHojaMovimientos(libro.addWorksheet('Entradas'), {
    ...contextoModulo,
    categoryLabel: `${modulo} · Entradas`,
    movimientos: combinado.entradas,
  });
  crearHojaMovimientos(libro.addWorksheet('Salidas'), {
    ...contextoModulo,
    categoryLabel: `${modulo} · Salidas`,
    movimientos: combinado.salidas,
  });
  crearHojaConsolidado(libro.addWorksheet('Consolidado por producto'), contextoModulo);

  if (categorias.length > 1) {
    categorias.forEach((categoria) => {
      crearHojaMovimientos(libro.addWorksheet(categoria.sheetName), categoria);
    });
  }

  const buffer = await libro.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
