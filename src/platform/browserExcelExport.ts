import ExcelJS from 'exceljs';
import type {
  FilaConsolidadoExcel,
  FilaMovimientoExcel,
  LoteMovimientoReporte,
  ReporteMovimientosPayload,
} from '../reporteMovimientosExcel';

const COLUMNAS = ['Nombre', 'Cantidad', 'Entrada', 'Salida', 'Fecha de ingreso', 'Fecha de salida', 'Observaciones'];
const COLUMNAS_AGRO = ['Lote', 'Fecha de vencimiento'];
const FILA_ENCABEZADO = 7;
const PRIMERA_FILA = FILA_ENCABEZADO + 1;
const COLOR = {
  marca: 'FF16532C', verde: 'FF087B3B', claro: 'FFE7F4E4', alterno: 'FFF4F9F5',
  texto: 'FF172118', linea: 'FFCDDCD0', blanco: 'FFFFFFFF',
};

type FilaReporte = {
  nombre: string;
  cantidad: number | null;
  entrada: number;
  salida: number;
  fechaIngreso: string;
  fechaSalida: string;
  observaciones: string;
  unidad: string;
  lotes: LoteMovimientoReporte[];
};

function nombreConReferencia(fila: FilaMovimientoExcel | FilaConsolidadoExcel) {
  const nombre = fila.nombre_producto;
  const referencia = fila.subcategoria.trim();
  return referencia && referencia.toLocaleLowerCase() !== nombre.trim().toLocaleLowerCase()
    ? `${nombre}\n${referencia}` : nombre;
}

function filaMovimiento(fila: FilaMovimientoExcel): FilaReporte {
  return {
    nombre: nombreConReferencia(fila), cantidad: fila.cantidad,
    entrada: fila.cantidad_entrada, salida: fila.cantidad_salida,
    fechaIngreso: fila.fecha_ingreso, fechaSalida: fila.fecha_salida,
    observaciones: fila.observacion,
    unidad: fila.unidad, lotes: fila.lotes,
  };
}

function filaConsolidada(fila: FilaConsolidadoExcel): FilaReporte {
  return {
    nombre: nombreConReferencia(fila), cantidad: fila.saldo_actual,
    entrada: fila.total_entradas, salida: fila.total_salidas,
    fechaIngreso: fila.fecha_ingreso, fechaSalida: fila.fecha_salida,
    observaciones: fila.observacion,
    unidad: fila.unidad, lotes: fila.lotes,
  };
}

function decimalesCantidad(valor: number | null) {
  return valor === null ? 0 : (valor.toFixed(6).replace(/0+$/, '').split('.')[1]?.length ?? 0);
}

function formatoCantidad(unidad: string, valor: number | null, precisionMinima = 0) {
  const sufijo = unidad.replace(/["\r\n]/g, '').trim();
  const precision = Math.max(precisionMinima, decimalesCantidad(valor));
  const numero = `#,##0${precision ? `.${'0'.repeat(precision)}` : ''}`;
  return `${numero}${sufijo ? `" ${sufijo}"` : ''};[Red]-${numero}${sufijo ? `" ${sufijo}"` : ''};"—"`;
}

const formatoFechaColombia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Excel guarda fechas sin zona horaria: conservar el día operativo de Colombia.
function fechaExcel(valor: string): ExcelJS.CellValue {
  if (!valor) return null;
  if (/^\d{4}-\d{2}$/.test(valor)) return valor; // Etiqueta sin día: no inventarlo.
  let dia = valor;
  if (/^\d{4}-\d{2}-\d{2}T/.test(valor) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(valor)) {
    const instante = new Date(valor);
    if (!Number.isFinite(instante.getTime())) return valor;
    const partes = formatoFechaColombia.formatToParts(instante);
    const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value;
    dia = `${parte('year')}-${parte('month')}-${parte('day')}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(dia);
  if (!match) return valor;
  const fecha = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === match[1] ? fecha : valor;
}

function celdasLotes(fila: FilaReporte): [ExcelJS.CellValue, ExcelJS.CellValue] {
  const lotes = [...fila.lotes];
  const asignado = lotes.reduce((total, lote) => total + lote.cantidad, 0);
  const pendiente = fila.cantidad === null ? 0 : fila.cantidad - asignado;
  if (pendiente > 0.000001) lotes.push({ numero: '', vencimiento: '', cantidad: pendiente });
  if (!lotes.length) return [null, null];
  const cantidad = (valor: number) => valor.toLocaleString('es-CO', { maximumFractionDigits: 6 });
  const nombres = lotes.map((lote) => `${lote.numero || 'Sin asignar'} (${cantidad(lote.cantidad)} ${fila.unidad})`);
  const fechas = lotes.map((lote) => lote.vencimiento || 'Sin fecha');
  return [nombres.join('\n'), fechas.length === 1 ? fechaExcel(fechas[0]) : fechas.join('\n')];
}

function relleno(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function crearHoja(
  workbook: ExcelJS.Workbook,
  payload: ReporteMovimientosPayload,
  nombre: string,
  filas: FilaReporte[],
  agro: boolean,
  consolidado = false,
  categoria = payload.moduleName,
) {
  const columnas = agro ? [...COLUMNAS, ...COLUMNAS_AGRO] : COLUMNAS;
  const anchos = agro ? [34, 16, 16, 16, 18, 18, 38, 29, 23] : [36, 16, 16, 16, 18, 18, 42];
  const sheet = workbook.addWorksheet(nombre, {
    properties: { defaultRowHeight: 32, tabColor: { argb: COLOR.verde } },
    views: [{ state: 'frozen', ySplit: FILA_ENCABEZADO, xSplit: 1, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
      printTitlesRow: `1:${FILA_ENCABEZADO}`,
    },
  });
  sheet.columns = anchos.map((width) => ({ width }));
  const ultimaColumna = sheet.getColumn(columnas.length).letter;
  const encabezados = [
    `${payload.companyName}  |  ${payload.moduleName.toLocaleUpperCase()}`,
    categoria === payload.moduleName ? nombre : `${nombre} · ${categoria}`,
    `Período: ${payload.periodLabel} · ${payload.coverageLabel}`,
    `Generado: ${payload.exportDate} · ${payload.generatedBy}`,
    consolidado
      ? 'Cantidad: disponible actual. Entrada y salida: totales del período. Fechas: última entrada y última salida del período.'
      : 'Cantidad: unidades del movimiento. Entrada / salida: cantidad según su dirección. Fechas según el registro original.',
  ];
  encabezados.forEach((texto, indice) => {
    const numero = indice + 1;
    sheet.mergeCells(numero, 1, numero, columnas.length);
    const celda = sheet.getCell(numero, 1);
    celda.value = texto;
    celda.fill = relleno(indice === 0 ? COLOR.marca : COLOR.claro);
    celda.font = {
      name: 'Calibri', size: indice < 2 ? 15 : 10, bold: indice < 2,
      color: { argb: indice === 0 ? COLOR.blanco : COLOR.marca },
    };
    celda.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    sheet.getRow(numero).height = indice < 2 ? 30 : 28;
  });
  sheet.getRow(6).height = 10;
  const header = sheet.getRow(FILA_ENCABEZADO);
  header.values = columnas;
  header.height = 32;
  header.eachCell((cell) => {
    cell.fill = relleno(COLOR.verde);
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR.blanco } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  filas.forEach((fila, indice) => {
    const valores: ExcelJS.CellValue[] = [
      fila.nombre, fila.cantidad, fila.entrada, fila.salida,
      fechaExcel(fila.fechaIngreso), fechaExcel(fila.fechaSalida), fila.observaciones,
      ...(agro ? celdasLotes(fila) : []),
    ];
    const row = sheet.getRow(PRIMERA_FILA + indice);
    row.values = valores;
    const lineas = valores.map((valor, i) => typeof valor === 'string'
      ? valor.split('\n').reduce((total, linea) => total + Math.max(1, Math.ceil(linea.length / (anchos[i] - 3))), 0) : 1);
    row.height = Math.min(409, Math.max(34, Math.max(...lineas) * 15 + 10));
    for (let columna = 1; columna <= columnas.length; columna += 1) {
      const cell = row.getCell(columna);
      cell.font = { name: 'Calibri', size: 11, color: { argb: COLOR.texto }, bold: columna === 1 };
      cell.fill = relleno(indice % 2 === 0 ? COLOR.blanco : COLOR.alterno);
      cell.border = { bottom: { style: 'hair', color: { argb: COLOR.linea } } };
      cell.alignment = {
        vertical: 'middle', wrapText: true,
        horizontal: columna >= 2 && columna <= 4 ? 'right' : columna === 5 || columna === 6 || columna === 9 ? 'center' : 'left',
      };
      if (columna >= 2 && columna <= 4) cell.numFmt = formatoCantidad(fila.unidad, valores[columna - 1] as number | null);
      if (columna === 5 || columna === 6 || columna === 9) cell.numFmt = 'dd/mm/yyyy';
    }
  });
  const ultimaFila = FILA_ENCABEZADO + filas.length;
  sheet.autoFilter = `A${FILA_ENCABEZADO}:${ultimaColumna}${Math.max(FILA_ENCABEZADO, ultimaFila)}`;
  const rowTotal = sheet.getRow(ultimaFila + 1);
  rowTotal.height = 34;
  const unidades = new Set(filas.map((fila) => fila.unidad.trim().toLocaleLowerCase()));
  if (filas.length && unidades.size === 1) {
    rowTotal.getCell(1).value = 'TOTAL';
    for (let columna = 2; columna <= 4; columna += 1) {
      const letra = sheet.getColumn(columna).letter;
      const campo = columna === 2 ? 'cantidad' : columna === 3 ? 'entrada' : 'salida';
      if (filas.some((fila) => fila[campo] === null)) continue;
      const total = filas.reduce((suma, fila) => suma + (fila[campo] ?? 0), 0);
      rowTotal.getCell(columna).value = {
        formula: `SUBTOTAL(109,${letra}${PRIMERA_FILA}:${letra}${ultimaFila})`,
        result: total,
      };
      const precision = filas.reduce((maximo, fila) => Math.max(maximo, decimalesCantidad(fila[campo])), 0);
      rowTotal.getCell(columna).numFmt = formatoCantidad(filas[0].unidad, total, precision);
    }
  } else {
    sheet.mergeCells(rowTotal.number, 1, rowTotal.number, columnas.length);
    rowTotal.getCell(1).value = filas.length
      ? 'Totales no sumados: el reporte contiene unidades diferentes.' : 'Sin registros para los filtros seleccionados.';
  }
  for (let columna = 1; columna <= columnas.length; columna += 1) {
    const cell = rowTotal.getCell(columna);
    cell.fill = relleno(COLOR.claro);
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR.marca } };
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: columna >= 2 && columna <= 4 ? 'right' : 'left' };
    cell.border = { top: { style: 'thin', color: { argb: COLOR.verde } } };
  }
  sheet.pageSetup.printArea = `A1:${ultimaColumna}${rowTotal.number}`;
  sheet.headerFooter.oddFooter = '&LARLES S.A.S.&RPágina &P de &N';
  return sheet;
}

export async function generarReporteMovimientosExcelWeb(payload: ReporteMovimientosPayload): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = payload.generatedBy;
  workbook.company = payload.companyName;
  workbook.title = payload.title;
  workbook.calcProperties.fullCalcOnLoad = true;
  const agro = payload.moduleName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s/g, '') === 'agroquimicos';
  crearHoja(workbook, payload, 'Movimientos generales', payload.movimientosGenerales.map(filaMovimiento), agro);
  crearHoja(workbook, payload, 'Entradas', payload.entradasGenerales.map(filaMovimiento), agro);
  crearHoja(workbook, payload, 'Salidas', payload.salidasGenerales.map(filaMovimiento), agro);
  crearHoja(workbook, payload, 'Consolidado por producto', payload.categorias.flatMap((categoria) => categoria.consolidated.map(filaConsolidada)), agro, true);
  if (payload.categorias.length > 1) {
    for (const categoria of payload.categorias) {
      crearHoja(workbook, payload, categoria.sheetName, categoria.movimientos.map(filaMovimiento), agro, false, categoria.categoryLabel);
    }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
