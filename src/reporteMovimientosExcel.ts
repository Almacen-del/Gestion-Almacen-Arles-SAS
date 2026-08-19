import {
  esEntradaVistaTaller,
  esSalidaVistaTaller,
  movimientoPerteneceSubmoduloTaller,
  normalizarSubmoduloTaller,
  TALLER_SUBMODULOS,
} from './tallerCanonicos';
import { modules } from './theme';

export const REPORTE_MOVIMIENTOS_FILENAME = 'Reporte_Movimientos_ARLES.xlsx';

export const MODULOS_ORDEN = modules;

export type MovimientoParaReporte = {
  id: string;
  modulo: string;
  tipo: string;
  codigo: string;
  descripcion: string;
  referencia: string;
  cantidad: number;
  unidad: string;
  fecha: string;
  solicitante: string;
  cargo: string;
  usuario: string;
  observaciones: string;
  fotoUrl: string;
  submodulo?: string;
  submoduloOrigen?: string;
  maquinaria?: string;
  labor?: string;
  frente?: string;
  zona?: string;
  horometro?: string;
  responsableEntrega?: string;
};

export type InventarioParaReporte = {
  id: string;
  modulo: string;
  codigo: string;
  descripcion: string;
  referencia: string;
  unidad: string;
  saldo_actual: number;
  submodulo?: string;
  codigos_alternos?: string[];
};

export type FilaMovimientoExcel = {
  fecha: string;
  tipo_movimiento: string;
  codigo: string;
  nombre_producto: string;
  submodulo: string;
  subcategoria: string;
  cantidad_entrada: number;
  cantidad_salida: number;
  unidad: string;
  saldo_anterior: number;
  saldo_nuevo: number;
  estado_conciliacion: string;
  responsable: string;
  observacion: string;
  documento_soporte: string;
  labor: string;
  zona: string;
  horometro: string;
};

export type FilaConsolidadoExcel = {
  codigo: string;
  nombre_producto: string;
  submodulo: string;
  subcategoria: string;
  total_entradas: number;
  total_salidas: number;
  variacion_neta: number;
  saldo_inicial_reconstruido: number | null;
  saldo_cierre_mostrado: number | null;
  saldo_actual: number | null;
  unidad: string;
  estado_conciliacion: string;
};

export type ResumenCategoria = {
  total_movimientos: number;
  total_entradas: number;
  total_salidas: number;
  cantidad_entradas: number;
  cantidad_salidas: number;
};

export type HojaCategoriaReporte = {
  sheetKey: string;
  sheetName: string;
  categoryLabel: string;
  moduleName: string;
  submodulo?: string;
  movimientos: FilaMovimientoExcel[];
  entradas: FilaMovimientoExcel[];
  salidas: FilaMovimientoExcel[];
  consolidated: FilaConsolidadoExcel[];
  summary: ResumenCategoria;
};

export type ResumenReporte = ResumenCategoria & {
  total_categorias: number;
  productos_inventario: number;
  productos_con_observacion: number;
};

export type ReporteMovimientosPayload = {
  companyName: string;
  title: string;
  moduleName: string;
  suggestedFileName: string;
  periodLabel: string;
  exportDate: string;
  generatedBy: string;
  coverageLabel: string;
  summary: ResumenReporte;
  categorias: HojaCategoriaReporte[];
  movimientosGenerales: FilaMovimientoExcel[];
  entradasGenerales: FilaMovimientoExcel[];
  salidasGenerales: FilaMovimientoExcel[];
};

export type ExportarReporteResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
};

type UsuarioLookup = Record<string, { nombre: string; cargo: string; email: string }>;

type CategoriaMovimiento = {
  sheetKey: string;
  sheetName: string;
  categoryLabel: string;
  moduleName: string;
  submodulo?: string;
  order: number;
};

function normalizar(texto: string) {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function normalizarModulo(texto: string) {
  return normalizar(texto).replace(/\s+/g, '');
}

function coincideModulo(valor: string, modulo: string) {
  const a = normalizarModulo(valor);
  const b = normalizarModulo(modulo);
  if (modulo === 'TALLER') return a === 'taller' || a.includes('herramienta');
  if (b === 'agroquimicos') return a === 'agroquimicos' || a.includes('agroquimico');
  if (b === 'lubricantestaller') return a === 'lubricantestaller' || (a.includes('lubricante') && a.includes('taller'));
  if (b === 'aseo') return a === 'aseo';
  return a === b || a.includes(b);
}

function sanitizarNombreHoja(nombre: string) {
  return nombre.replace(/[\\/*?:[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Categoria';
}

function ordenCategoria(modulo: string, submodulo?: string) {
  const moduloIndex = MODULOS_ORDEN.findIndex((entry) => entry === modulo);
  const base = moduloIndex >= 0 ? moduloIndex : MODULOS_ORDEN.length + 1;
  if (modulo !== 'TALLER' || !submodulo) return base * 100;
  const subIndex = TALLER_SUBMODULOS.findIndex((entry) => entry === submodulo);
  return base * 100 + (subIndex >= 0 ? subIndex : 99);
}

function esMovimientoSistema(movimiento: MovimientoParaReporte) {
  const modulo = normalizar(movimiento.modulo);
  return modulo === 'sistema' || modulo.includes('sistema');
}

function resolverCategoria(movimiento: MovimientoParaReporte): CategoriaMovimiento {
  const moduloDetectado = MODULOS_ORDEN.find((modulo) => coincideModulo(movimiento.modulo, modulo));
  const modulo = moduloDetectado || movimiento.modulo || 'Sin módulo';

  if (modulo === 'TALLER') {
    const submodulo = normalizarSubmoduloTaller(movimiento.submodulo || movimiento.referencia || 'SIN SUBMODULO');
    const categoryLabel = `Taller · ${submodulo}`;
    return {
      sheetKey: `TALLER::${submodulo}`,
      sheetName: sanitizarNombreHoja(categoryLabel),
      categoryLabel,
      moduleName: 'TALLER',
      submodulo,
      order: ordenCategoria('TALLER', submodulo),
    };
  }

  const categoryLabel = modulo;
  return {
    sheetKey: modulo,
    sheetName: sanitizarNombreHoja(categoryLabel),
    categoryLabel,
    moduleName: modulo,
    order: ordenCategoria(modulo),
  };
}

function claveProducto(movimiento: MovimientoParaReporte, categoria: CategoriaMovimiento) {
  const modulo = normalizarModulo(categoria.moduleName || 'sinmodulo');
  const codigo = movimiento.codigo.trim();
  if (codigoUtil(codigo)) return `${modulo}::${normalizar(codigo)}`;
  const descripcion = normalizar(movimiento.descripcion);
  const referencia = normalizar(movimiento.referencia);
  if (descripcion) return `${modulo}::${descripcion}|${referencia}`;
  return `${modulo}::${referencia || 'sinreferencia'}`;
}

function codigoUtil(codigo: string) {
  const valor = normalizar(codigo);
  return Boolean(valor && valor !== 'sin codigo' && valor !== 'sin referencia' && valor !== 'n/a');
}

function descripcionParaConciliar(descripcion: string) {
  return normalizar(descripcion)
    .replace(/\(\s*talla\s*[:\-]?\s*[^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function claveNombreReferencia(descripcion: string, referencia: string) {
  return `${descripcionParaConciliar(descripcion)}|${normalizar(referencia)}`;
}

function esEntrada(movimiento: MovimientoParaReporte, moduleName = '', tallerSubmodulo = '') {
  if (moduleName === 'TALLER' && tallerSubmodulo) return esEntradaVistaTaller(movimiento, tallerSubmodulo);
  const tipo = normalizar(movimiento.tipo);
  return tipo.includes('entrada') || tipo.includes('ingreso');
}

function esSalida(movimiento: MovimientoParaReporte, moduleName = '', tallerSubmodulo = '') {
  if (moduleName === 'TALLER' && tallerSubmodulo) return esSalidaVistaTaller(movimiento, tallerSubmodulo);
  const tipo = normalizar(movimiento.tipo);
  return tipo.includes('salida') || tipo.includes('entrega') || tipo.includes('traslado') || tipo.includes('consumo');
}

function ordenarPorFechaAsc(a: MovimientoParaReporte, b: MovimientoParaReporte) {
  return (a.fecha || '').localeCompare(b.fecha || '') || a.id.localeCompare(b.id);
}

function formatearFechaCorta(fechaIso: string) {
  const [year, month, day] = fechaIso.split('-');
  if (!year || !month || !day) return fechaIso;
  return `${day}/${month}/${year}`;
}

export function etiquetaPeriodoReporte(desde: string, hasta: string) {
  if (!desde && !hasta) return 'Histórico completo';
  if (desde && hasta) return `${formatearFechaCorta(desde)} al ${formatearFechaCorta(hasta)}`;
  if (desde) return `Desde ${formatearFechaCorta(desde)}`;
  return `Hasta ${formatearFechaCorta(hasta)}`;
}

export function fechaExportacionReporte(fecha = new Date()) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(fecha);
}

function responsableMovimiento(movimiento: MovimientoParaReporte, usuarios: UsuarioLookup) {
  const candidato = movimiento.solicitante || movimiento.responsableEntrega || movimiento.usuario || '';
  const perfil = usuarios[candidato.trim()];
  if (perfil) {
    return [perfil.nombre || perfil.email, perfil.cargo].filter(Boolean).join(' - ');
  }
  return [candidato, movimiento.cargo].filter(Boolean).join(' - ') || 'Sin responsable';
}

function crearFilaMovimiento(
  movimiento: MovimientoParaReporte,
  categoria: CategoriaMovimiento,
  saldoAnterior: number,
  saldoNuevo: number,
  estadoConciliacion: string,
  usuarios: UsuarioLookup,
): FilaMovimientoExcel {
  const contextoSubmodulo = categoria.moduleName === 'TALLER' ? (categoria.submodulo ?? '') : '';
  return {
    fecha: movimiento.fecha || 'Sin fecha',
    tipo_movimiento: movimiento.tipo || 'Movimiento',
    codigo: movimiento.codigo || 'Sin código',
    nombre_producto: movimiento.descripcion || 'Sin descripción',
    submodulo: categoria.submodulo || categoria.moduleName,
    subcategoria: movimiento.referencia || movimiento.submodulo || '',
    cantidad_entrada: esEntrada(movimiento, categoria.moduleName, contextoSubmodulo) ? movimiento.cantidad : 0,
    cantidad_salida: esSalida(movimiento, categoria.moduleName, contextoSubmodulo) ? movimiento.cantidad : 0,
    unidad: movimiento.unidad || 'Unidad',
    saldo_anterior: saldoAnterior,
    saldo_nuevo: saldoNuevo,
    estado_conciliacion: estadoConciliacion,
    responsable: responsableMovimiento(movimiento, usuarios),
    observacion: movimiento.observaciones || '',
    documento_soporte: movimiento.fotoUrl || '',
    labor: movimiento.labor || movimiento.frente || '',
    zona: movimiento.zona || '',
    horometro: movimiento.horometro ? String(movimiento.horometro) : '',
  };
}

type MotivoSinVincular =
  | 'Código duplicado en inventario'
  | 'Movimiento sin producto actual'
  | 'Sin código; coincidencia ambigua'
  | 'Sin código; producto no encontrado';

type ResultadoVinculacion = {
  inventario?: InventarioParaReporte;
  estado: string;
  motivoSinVincular?: MotivoSinVincular;
};

type GrupoConciliacion = {
  inventario?: InventarioParaReporte;
  movimientos: MovimientoParaReporte[];
  estadoBase: string;
};

function agregarIndice(
  indice: Map<string, InventarioParaReporte[]>,
  clave: string,
  inventario: InventarioParaReporte,
) {
  const actuales = indice.get(clave) ?? [];
  if (!actuales.some((actual) => actual.id === inventario.id)) actuales.push(inventario);
  indice.set(clave, actuales);
}

function vincularMovimiento(
  movimiento: MovimientoParaReporte,
  porCodigo: Map<string, InventarioParaReporte[]>,
  porNombreReferencia: Map<string, InventarioParaReporte[]>,
): ResultadoVinculacion {
  if (codigoUtil(movimiento.codigo)) {
    const candidatos = porCodigo.get(normalizar(movimiento.codigo)) ?? [];
    if (candidatos.length === 1) {
      return { inventario: candidatos[0], estado: 'Conciliado con inventario' };
    }
    if (candidatos.length > 1) {
      return {
        estado: 'Código duplicado en inventario',
        motivoSinVincular: 'Código duplicado en inventario',
      };
    }
    return {
      estado: 'Movimiento sin producto actual',
      motivoSinVincular: 'Movimiento sin producto actual',
    };
  }

  const candidatos = porNombreReferencia.get(
    claveNombreReferencia(movimiento.descripcion, movimiento.referencia),
  ) ?? [];
  if (candidatos.length === 1) {
    return { inventario: candidatos[0], estado: 'Vinculado por nombre y referencia' };
  }
  if (candidatos.length > 1) {
    return {
      estado: 'Sin código; coincidencia ambigua',
      motivoSinVincular: 'Sin código; coincidencia ambigua',
    };
  }
  return {
    estado: 'Sin código; producto no encontrado',
    motivoSinVincular: 'Sin código; producto no encontrado',
  };
}

function deltaMovimiento(movimiento: MovimientoParaReporte, categoria: CategoriaMovimiento) {
  const contextoSubmodulo = categoria.moduleName === 'TALLER' ? (categoria.submodulo ?? '') : '';
  if (esEntrada(movimiento, categoria.moduleName, contextoSubmodulo)) return movimiento.cantidad;
  if (esSalida(movimiento, categoria.moduleName, contextoSubmodulo)) return -movimiento.cantidad;
  return null;
}

function unirEstados(...estados: Array<string | undefined>) {
  return [...new Set(estados.filter((estado): estado is string => Boolean(estado)))].join(' · ');
}

function conciliarCategoria(
  movimientosVisibles: MovimientoParaReporte[],
  historialCompleto: MovimientoParaReporte[],
  inventarioActual: InventarioParaReporte[],
  categoria: CategoriaMovimiento,
  usuarios: UsuarioLookup,
) {
  const porCodigo = new Map<string, InventarioParaReporte[]>();
  const porNombreReferencia = new Map<string, InventarioParaReporte[]>();
  const grupos = new Map<string, GrupoConciliacion>();
  const claveGrupoPorMovimiento = new Map<string, string>();

  inventarioActual.forEach((inventario) => {
    [inventario.codigo, ...(inventario.codigos_alternos ?? [])]
      .filter(codigoUtil)
      .forEach((codigo) => agregarIndice(porCodigo, normalizar(codigo), inventario));
    agregarIndice(
      porNombreReferencia,
      claveNombreReferencia(inventario.descripcion, inventario.referencia),
      inventario,
    );
    grupos.set(`inventario::${inventario.id}`, {
      inventario,
      movimientos: [],
      estadoBase: 'Inventario sin movimientos',
    });
  });

  historialCompleto.forEach((movimiento) => {
    const vinculacion = vincularMovimiento(movimiento, porCodigo, porNombreReferencia);
    const clave = vinculacion.inventario
      ? `inventario::${vinculacion.inventario.id}`
      : `movimiento::${vinculacion.motivoSinVincular ?? 'sin-vincular'}::${claveProducto(movimiento, categoria)}`;
    const actual = grupos.get(clave) ?? {
      inventario: vinculacion.inventario,
      movimientos: [],
      estadoBase: vinculacion.estado,
    };
    actual.movimientos.push(movimiento);
    if (vinculacion.inventario) {
      actual.estadoBase = actual.estadoBase === 'Vinculado por nombre y referencia'
        || vinculacion.estado === 'Vinculado por nombre y referencia'
        ? 'Vinculado por nombre y referencia'
        : 'Conciliado con inventario';
    }
    grupos.set(clave, actual);
    claveGrupoPorMovimiento.set(movimiento.id, clave);
  });

  const idsVisibles = new Set(movimientosVisibles.map((movimiento) => movimiento.id));
  const visiblesPorGrupo = new Map<string, MovimientoParaReporte[]>();
  movimientosVisibles.forEach((movimiento) => {
    const clave = claveGrupoPorMovimiento.get(movimiento.id);
    if (!clave) return;
    const actuales = visiblesPorGrupo.get(clave) ?? [];
    actuales.push(movimiento);
    visiblesPorGrupo.set(clave, actuales);
  });
  const filasPorMovimiento = new Map<string, FilaMovimientoExcel>();
  const consolidado: FilaConsolidadoExcel[] = [];

  grupos.forEach((grupo, claveGrupo) => {
    const ordenados = [...grupo.movimientos].sort(ordenarPorFechaAsc);
    const variacionHistorica = ordenados.reduce((suma, movimiento) => (
      suma + (deltaMovimiento(movimiento, categoria) ?? 0)
    ), 0);
    const saldoActual = grupo.inventario?.saldo_actual ?? null;
    const saldoInicial = saldoActual === null ? 0 : saldoActual - variacionHistorica;
    let saldo = saldoInicial;
    let saldoNegativo = saldo < 0;
    let tipoNoReconocido = false;
    const balances = new Map<string, { anterior: number; nuevo: number; reconocido: boolean }>();

    ordenados.forEach((movimiento) => {
      const anterior = saldo;
      const delta = deltaMovimiento(movimiento, categoria);
      if (delta === null) {
        tipoNoReconocido = true;
      } else {
        saldo += delta;
      }
      if (saldo < 0) saldoNegativo = true;
      balances.set(movimiento.id, { anterior, nuevo: saldo, reconocido: delta !== null });
    });

    const estadoGrupo = unirEstados(
      grupo.estadoBase,
      saldoNegativo ? 'Revisar: saldo reconstruido negativo' : undefined,
      tipoNoReconocido ? 'Revisar: tipo de movimiento no reconocido' : undefined,
    );

    ordenados.forEach((movimiento) => {
      if (!idsVisibles.has(movimiento.id)) return;
      const balance = balances.get(movimiento.id);
      if (!balance) return;
      filasPorMovimiento.set(
        movimiento.id,
        crearFilaMovimiento(
          movimiento,
          categoria,
          balance.anterior,
          balance.nuevo,
          estadoGrupo,
          usuarios,
        ),
      );
    });

    const visiblesDelGrupo = [...(visiblesPorGrupo.get(claveGrupo) ?? [])].sort(ordenarPorFechaAsc);
    if (!grupo.inventario && visiblesDelGrupo.length === 0) return;

    const referencia = grupo.inventario ?? visiblesDelGrupo[0] ?? ordenados[0];
    if (!referencia) return;

    let totalEntradas = 0;
    let totalSalidas = 0;
    visiblesDelGrupo.forEach((movimiento) => {
      const delta = deltaMovimiento(movimiento, categoria);
      if (delta !== null && delta > 0) totalEntradas += movimiento.cantidad;
      if (delta !== null && delta < 0) totalSalidas += movimiento.cantidad;
    });
    const existenciaInicialVisible = saldoActual === null
      ? null
      : saldoActual - totalEntradas + totalSalidas;
    const ultimoVisible = visiblesDelGrupo.at(-1);
    const saldoCierre = ultimoVisible
      ? (balances.get(ultimoVisible.id)?.nuevo ?? null)
      : saldoActual;

    consolidado.push({
      codigo: referencia.codigo || 'Sin código',
      nombre_producto: referencia.descripcion || 'Sin descripción',
      submodulo: categoria.submodulo || categoria.moduleName,
      subcategoria: referencia.referencia || '',
      total_entradas: totalEntradas,
      total_salidas: totalSalidas,
      variacion_neta: totalEntradas - totalSalidas,
      saldo_inicial_reconstruido: existenciaInicialVisible,
      saldo_cierre_mostrado: saldoCierre,
      saldo_actual: saldoActual,
      unidad: referencia.unidad || 'Unidad',
      estado_conciliacion: estadoGrupo,
    });
  });

  const filas = movimientosVisibles
    .map((movimiento) => filasPorMovimiento.get(movimiento.id))
    .filter((fila): fila is FilaMovimientoExcel => Boolean(fila));

  consolidado.sort((a, b) => (
    a.nombre_producto.localeCompare(b.nombre_producto) || a.codigo.localeCompare(b.codigo)
  ));

  return { filas, consolidado };
}

function resumenDesdeFilas(filas: FilaMovimientoExcel[]): ResumenCategoria {
  const entradas = filas.filter((fila) => fila.cantidad_entrada > 0);
  const salidas = filas.filter((fila) => fila.cantidad_salida > 0);
  return {
    total_movimientos: filas.length,
    total_entradas: entradas.length,
    total_salidas: salidas.length,
    cantidad_entradas: entradas.reduce((suma, fila) => suma + fila.cantidad_entrada, 0),
    cantidad_salidas: salidas.reduce((suma, fila) => suma + fila.cantidad_salida, 0),
  };
}

function movimientoPerteneceAlModulo(
  movimiento: MovimientoParaReporte,
  moduleName: string,
  tallerSubmodulo: string,
) {
  if (esMovimientoSistema(movimiento)) return false;
  if (!coincideModulo(movimiento.modulo, moduleName)) return false;
  if (moduleName === 'TALLER' && tallerSubmodulo) {
    return movimientoPerteneceSubmoduloTaller(movimiento, tallerSubmodulo);
  }
  return true;
}

function categoriaTaller(submodulo: string): CategoriaMovimiento {
  const submoduloNormalizado = normalizarSubmoduloTaller(submodulo || 'SIN SUBMODULO');
  const categoryLabel = `Taller · ${submoduloNormalizado}`;
  return {
    sheetKey: `TALLER::${submoduloNormalizado}`,
    sheetName: sanitizarNombreHoja(categoryLabel),
    categoryLabel,
    moduleName: 'TALLER',
    submodulo: submoduloNormalizado,
    order: ordenCategoria('TALLER', submoduloNormalizado),
  };
}

function inventarioPerteneceAlModulo(
  inventario: InventarioParaReporte,
  moduleName: string,
  tallerSubmodulo: string,
) {
  if (!coincideModulo(inventario.modulo, moduleName)) return false;
  if (moduleName === 'TALLER' && tallerSubmodulo) {
    return normalizarSubmoduloTaller(inventario.submodulo || inventario.referencia)
      === normalizarSubmoduloTaller(tallerSubmodulo);
  }
  return true;
}

function movimientoPerteneceCategoria(
  movimiento: MovimientoParaReporte,
  categoria: CategoriaMovimiento,
) {
  if (!movimientoPerteneceAlModulo(movimiento, categoria.moduleName, categoria.submodulo ?? '')) {
    return false;
  }
  if (categoria.moduleName !== 'TALLER' || !categoria.submodulo) return true;
  return movimientoPerteneceSubmoduloTaller(movimiento, categoria.submodulo);
}

function inventarioPerteneceCategoria(
  inventario: InventarioParaReporte,
  categoria: CategoriaMovimiento,
) {
  return inventarioPerteneceAlModulo(
    inventario,
    categoria.moduleName,
    categoria.submodulo ?? '',
  );
}

function categoriasModuloSeleccionado(
  movimientos: MovimientoParaReporte[],
  historialCompleto: MovimientoParaReporte[],
  inventarioActual: InventarioParaReporte[],
  moduleName: string,
  tallerSubmodulo: string,
) {
  if (moduleName !== 'TALLER') {
    return [{
      sheetKey: moduleName,
      sheetName: sanitizarNombreHoja(moduleName),
      categoryLabel: moduleName,
      moduleName,
      order: ordenCategoria(moduleName),
    }];
  }

  if (tallerSubmodulo) {
    return [categoriaTaller(tallerSubmodulo)];
  }

  const categorias = new Map<string, CategoriaMovimiento>();
  [...movimientos, ...historialCompleto]
    .filter((movimiento) => movimientoPerteneceAlModulo(movimiento, moduleName, ''))
    .forEach((movimiento) => {
      const categoria = categoriaTaller(movimiento.submodulo || movimiento.referencia || 'SIN SUBMODULO');
      categorias.set(categoria.sheetKey, categoria);
    });
  inventarioActual
    .filter((inventario) => inventarioPerteneceAlModulo(inventario, moduleName, ''))
    .forEach((inventario) => {
      const categoria = categoriaTaller(inventario.submodulo || inventario.referencia || 'SIN SUBMODULO');
      categorias.set(categoria.sheetKey, categoria);
    });

  if (categorias.size === 0) {
    const categoria = categoriaTaller('SIN SUBMODULO');
    categorias.set(categoria.sheetKey, categoria);
  }

  return [...categorias.values()].sort((a, b) => a.order - b.order);
}

export function nombreArchivoReporte(moduleName: string) {
  const slug = moduleName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase();
  return `Reporte_Movimientos_${slug || 'modulo'}_ARLES.xlsx`;
}

function nombresHojaUnicos(categorias: HojaCategoriaReporte[]) {
  const usados = new Map<string, number>();
  return categorias.map((categoria) => {
    const base = categoria.sheetName;
    const conteo = usados.get(base) ?? 0;
    usados.set(base, conteo + 1);
    if (conteo === 0) return categoria;
    const sufijo = ` ${conteo + 1}`;
    return {
      ...categoria,
      sheetName: sanitizarNombreHoja(`${base.slice(0, 31 - sufijo.length)}${sufijo}`),
    };
  });
}

export function crearReporteMovimientos(opciones: {
  moduleName: string;
  tallerSubmodulo?: string;
  movimientos: MovimientoParaReporte[];
  historialCompleto?: MovimientoParaReporte[];
  inventarioActual?: InventarioParaReporte[];
  usuarios: UsuarioLookup;
  periodLabel: string;
  exportDate: string;
  generatedBy: string;
  coverageLabel: string;
}): ReporteMovimientosPayload {
  const historialCompleto = opciones.historialCompleto ?? opciones.movimientos;
  const inventarioActual = opciones.inventarioActual ?? [];
  const categoriasBase = categoriasModuloSeleccionado(
    opciones.movimientos,
    historialCompleto,
    inventarioActual,
    opciones.moduleName,
    opciones.tallerSubmodulo ?? '',
  );

  const filasPorMovimiento = new Map<string, FilaMovimientoExcel>();
  const categorias = nombresHojaUnicos(categoriasBase.map((categoria) => {
    const movimientos = opciones.movimientos.filter((movimiento) => (
      movimientoPerteneceCategoria(movimiento, categoria)
    ));
    const historialCategoria = historialCompleto.filter((movimiento) => (
      movimientoPerteneceCategoria(movimiento, categoria)
    ));
    const inventarioCategoria = inventarioActual.filter((inventario) => (
      inventarioPerteneceCategoria(inventario, categoria)
    ));
    const conciliacion = conciliarCategoria(
      movimientos,
      historialCategoria,
      inventarioCategoria,
      categoria,
      opciones.usuarios,
    );
    const filas = conciliacion.filas;
    movimientos.forEach((movimiento, index) => {
      const fila = filas[index];
      if (fila) filasPorMovimiento.set(movimiento.id, fila);
    });
    const entradas = filas.filter((fila) => fila.cantidad_entrada > 0);
    const salidas = filas.filter((fila) => fila.cantidad_salida > 0);
    return {
      sheetKey: categoria.sheetKey,
      sheetName: categoria.sheetName,
      categoryLabel: categoria.categoryLabel,
      moduleName: categoria.moduleName,
      submodulo: categoria.submodulo,
      movimientos: filas,
      entradas,
      salidas,
      consolidated: conciliacion.consolidado,
      summary: resumenDesdeFilas(filas),
    };
  }));

  const resumenGlobal = categorias.reduce<ResumenCategoria>(
    (acc, categoria) => ({
      total_movimientos: acc.total_movimientos + categoria.summary.total_movimientos,
      total_entradas: acc.total_entradas + categoria.summary.total_entradas,
      total_salidas: acc.total_salidas + categoria.summary.total_salidas,
      cantidad_entradas: acc.cantidad_entradas + categoria.summary.cantidad_entradas,
      cantidad_salidas: acc.cantidad_salidas + categoria.summary.cantidad_salidas,
    }),
    {
      total_movimientos: 0,
      total_entradas: 0,
      total_salidas: 0,
      cantidad_entradas: 0,
      cantidad_salidas: 0,
    },
  );

  const movimientosGenerales = opciones.movimientos
    .map((movimiento) => filasPorMovimiento.get(movimiento.id))
    .filter((fila): fila is FilaMovimientoExcel => Boolean(fila));
  const entradasGenerales = movimientosGenerales.filter((fila) => fila.cantidad_entrada > 0);
  const salidasGenerales = movimientosGenerales.filter((fila) => fila.cantidad_salida > 0);

  return {
    companyName: 'ARLES S.A.S.',
    title: 'REPORTE DE MOVIMIENTOS DE INVENTARIO',
    moduleName: opciones.moduleName,
    suggestedFileName: nombreArchivoReporte(opciones.moduleName),
    periodLabel: opciones.periodLabel,
    exportDate: opciones.exportDate,
    generatedBy: opciones.generatedBy,
    coverageLabel: opciones.coverageLabel,
    summary: {
      ...resumenGlobal,
      total_categorias: categorias.length,
      productos_inventario: categorias.reduce(
        (total, categoria) => total + categoria.consolidated.filter((fila) => fila.saldo_actual !== null).length,
        0,
      ),
      productos_con_observacion: categorias.reduce(
        (total, categoria) => total + categoria.consolidated.filter(
          (fila) => fila.estado_conciliacion !== 'Conciliado con inventario',
        ).length,
        0,
      ),
    },
    categorias,
    movimientosGenerales,
    entradasGenerales,
    salidasGenerales,
  };
}

