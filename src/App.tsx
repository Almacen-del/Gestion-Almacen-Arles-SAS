import ColumnFilterTable from './ui/ColumnFilterTable';
import AgrochemicalLocationSelect from './ui/AgrochemicalLocationSelect';
import { saveAgrochemicalLocation } from './agroquimicosUbicacion';
import { type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUserRoleListener } from './hooks/useUserRoleListener';

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Camera,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Inbox,
  LogOut,
  PackageCheck,
  Search,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  UserRound,
  UserCheck,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDocsFromServer,
  limit as firestoreLimit,
  onSnapshot,
  Timestamp,
  orderBy,
  query,
  QueryDocumentSnapshot,
  runTransaction,
  serverTimestamp,
  startAfter,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, firebaseProjectId } from './firebase';
import { verifyUserAuthorization } from './auth/authorization';
import { createCorporateAccount, signInWithNormalizedEmail } from './auth/browserAuth';
import { filterAndSortInventoryView } from './inventoryView';
import {
  hasPanelCacheData,
  loadPanelCache,
  removeLegacyPanelCache,
  savePanelCache,
} from './cache/panelCache';
import {
  AGROQUIMICOS_UBICACIONES,
  coincideUbicacionAgroquimicos,
  etiquetaUbicacionAgroquimicos,
  movimientoPerteneceUbicacionAgroquimicos,
} from './agroquimicosCanonicos';
import {
  coincideSubmoduloTaller,
  esBodegaRojaTaller,
  esEntradaVistaTaller,
  esSalidaVistaTaller,
  esTrasladoMovimiento,
  etiquetasMovimientoTaller,
  extraerNumeroQr,
  movimientoPerteneceSubmoduloTaller,
  normalizarSubmoduloTaller,
  resolverSubmoduloDesdeCampos,
  TALLER_SUBMODULOS,
} from './tallerCanonicos';
import SubmoduleButtons from './ui/SubmoduleButtons';
import InventoryValuationModule from './ui/InventoryValuationModule';
import InventoryAnalysisPanel from './ui/InventoryAnalysisPanel';
import AgrochemicalExpirationModal, {
  type AgrochemicalLotRegistration,
} from './ui/AgrochemicalExpirationModal';
import ValuationEditModal from './ui/ValuationEditModal';
import type { CurrentValuationRow, ValuationSaveState } from './valuation/models';
import { calculateEstimatedExitExpense } from './valuation/exitExpense';
import type { MonthlyActivitySource } from './valuation/monthlyActivity';
import {
  subscribeEntryStockMovements,
  subscribeEntryValuationRecords,
  type EntryStockMovement,
  type EntryValuationRecord,
} from './valuation/entryValuation';
import {
  areSourcesServerReady,
  CLOSE_REQUIRED_SOURCE_KEYS,
  createInitialFirestoreSourceStates,
  FIRESTORE_SOURCE_KEYS,
  PANEL_REQUIRED_SOURCE_KEYS,
  sourceErrorMessages,
  isServerSourceReady,
  type FirestoreSourceKey,
  updateSourceFromSnapshot,
  updateSourceWithError,
} from './valuation/firestoreSync';
import {
  isHistoricalInventoryModule,
  isInventoryValuationModuleIncluded,
} from './valuation/inventoryValuationScope';
import {
  captureValuationBaseline,
  emptyValuationRevision,
  ManualValuationBlockedError,
  ManualValuationConflictError,
  removeValuationBaseline,
  saveManualUnitValuation,
  valuationRevisionFromData,
  type ManualValuationConflict,
  type ManualValuationRevision,
} from './valuation/manualValuation';
import {
  crearReporteMovimientos,
  etiquetaPeriodoReporte,
  fechaExportacionReporte,
  leerLotesSalidaReporte,
  nombreArchivoReporte,
  type InventarioParaReporte,
  type LoteMovimientoReporte,
} from './reporteMovimientosExcel';
import { browserPlatform, exportMovementReportWeb } from './platform/browserPlatform';
import {
  agrochemicalLotDocumentId,
  buildAgrochemicalEntryQueue,
  earliestAvailableLotExpirationByProduct,
  type AgrochemicalLot,
} from './agrochemicalLots';
import {
  filterAndSortMovementView,
  loadedMovementHistoryCoversDate,
  mergeMovementPages,
  movementDisplayCount,
  movementPageHasMore,
  MOVEMENT_PAGE_SIZE,
  nextMovementDisplayLimit,
  shouldAutoLoadCompleteMovementHistory,
} from './movementView';
import {
  beginTallerStatusUpdate,
  createInitialTallerStatusState,
  effectiveTallerStatus,
  isTallerStatusBusy,
  markTallerStatusWriteAccepted,
  reconcileTallerStatusSnapshot,
  rollbackTallerStatusUpdate,
  sortTallerInventory,
  tallerStatusRank,
  type TallerStatusOrder,
} from './tallerStatus';
import {
  brand,
  inventoryIndicatorsModule,
  inventoryValuationModule,
  moduleAccent,
  moduleDescription,
  modules,
} from './theme';

const logoSrc = './logo-arles.jpeg';
const brandName = brand.name;
const operationalModules = modules.filter((entry) => (
  entry !== inventoryValuationModule && entry !== inventoryIndicatorsModule
));

const moduleIcons: Record<string, string> = {
  [inventoryValuationModule]: './module-icons/valoracion.svg',
  [inventoryIndicatorsModule]: './module-icons/indicadores.svg',
  EPP: './module-icons/epp.svg',
  Dotación: './module-icons/dotacion.svg',
  Consumibles: './module-icons/consumibles.svg',
  ASEO: './module-icons/aseo.svg',
  Agroquimicos: './module-icons/agroquimicos.svg',
  'Lubricantes taller': './module-icons/lubricantes.svg',
  Químico: './module-icons/quimico.svg',
  Combustible: './module-icons/combustible.svg',
  TALLER: './module-icons/herramientas.svg',
};

function moduleIcon(moduleName: string) {
  return moduleIcons[moduleName] ?? './module-icons/consumibles.svg';
}

type InventoryItem = {
  id: string;
  valuationId: string;
  modulo: string;
  codigo: string;
  descripcion: string;
  referencia: string;
  categoria: string;
  unidad: string;
  saldo: number;
  estado?: string;
  ubicacion?: string;
  subcategoria?: string;
  marca?: string;
  caracteristica?: string;
  total?: number;
  ocupados?: number;
  requiereQr?: boolean;
  codigoQr?: string;
  responsable?: string;
  expirationDate?: string;
  confirmedObsolete?: boolean;
};

type OccupiedUnitCard = {
  id: string;
  submodulo: string;
  codigo: string;
  descripcion: string;
  subcategoria?: string;
  caracteristica?: string;
  solicitante: string;
  unitIndex: number;
  unitTotal: number;
};

type OccupiedSubmoduleGroup = {
  submodulo: string;
  items: OccupiedUnitCard[];
};

type Movement = {
  destinationLot?: string;
  monthlyOccurredAt?: string;
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
  ubicacion?: string;
  zona?: string;
  labor?: string;
  frente?: string;
  horometro?: string;
  responsableEntrega?: string;
  productDocumentId?: string;
  documentId?: string;
  stockBefore?: number;
  stockAfter?: number;
  lote?: string;
  fechaVencimiento?: string;
  lotesSalida?: LoteMovimientoReporte[];
};

type UserProfile = {
  id: string;
  nombre: string;
  cargo: string;
  email: string;
  rol: string;
  estado: string;
  activo: boolean;
};

type Totals = Record<string, { entradas: number; salidas: number }>;

const retiredToolCodes = new Set(['001', '002', 'QR-001', 'QR-002']);

function textValue(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function numberValue(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function optionalNumberValue(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function valuationDocumentId(source: string, id: string) {
  return `${source}__${encodeURIComponent(id)}`;
}

function withValuationId(item: InventoryItem): InventoryItem {
  if (item.valuationId) return item;
  if (item.id.startsWith('aseo-')) {
    return { ...item, valuationId: valuationDocumentId('productos_aseo', item.id.replace(/^aseo-/, '')) };
  }
  if (item.id.startsWith('herramienta-')) {
    return { ...item, valuationId: valuationDocumentId('herramientas', item.id.replace(/^herramienta-/, '')) };
  }
  if (item.id.startsWith('fallback-')) {
    return { ...item, valuationId: valuationDocumentId('catalogo_respaldo', item.id.replace(/^fallback-/, '')) };
  }
  return { ...item, valuationId: valuationDocumentId('existencias', item.id) };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

function valuationQuantity(item: InventoryItem) {
  return Math.max(item.total ?? item.saldo, 0);
}

function findValueByKeyPart(data: Record<string, unknown>, parts: string[]): string {
  // Busca en cualquier key que contenga alguna de las partes (útil para Combustible donde los nombres de campo pueden variar)
  const entries = Object.entries(data);
  const lowerParts = parts.map(p => p.toLowerCase());
  for (const [key, value] of entries) {
    const k = key.toLowerCase();
    if (lowerParts.some(part => k.includes(part))) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
  }
  return '';
}

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function normalizeModule(text: string) {
  return normalize(text).replace(/\s+/g, '');
}

function moduleMatches(value: string, module: string) {
  const a = normalizeModule(value);
  const b = normalizeModule(module);
  if (module === 'TALLER') return a === 'taller' || a.includes('herramienta');
  if (b === 'agroquimicos') return a === 'agroquimicos' || a.includes('agroquimico');
  if (b === 'lubricantestaller') return a === 'lubricantestaller' || (a.includes('lubricante') && a.includes('taller'));
  if (b === 'aseo') return a === 'aseo';
  return a === b || a.includes(b);
}

function valuationModuleForItem(item: InventoryItem) {
  return operationalModules.find((moduleName) => moduleMatches(item.modulo, moduleName)) ?? item.modulo;
}

function isChemicalModule(moduleName: string) {
  return moduleMatches(moduleName, 'Agroquimicos') || moduleMatches(moduleName, 'Lubricantes taller');
}

function normalizeAseoCode(value: string) {
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/^H(\d{2})(\d{3})$/);
  return match ? `H${match[1]}-${match[2]}` : value.trim().toUpperCase();
}

function normalizeToolCode(value: string) {
  const clean = value.trim().toUpperCase();
  if (/^\d+$/.test(clean)) return `QR-${clean}`;
  return clean;
}

function displayCodeForInventory(data: Record<string, unknown>, modulo: string, fallback: string) {
  if (isChemicalModule(modulo)) {
    return textValue(data, 'codigo_original', 'codigoOriginal', 'codigo_excel', 'codigo', 'codigo_interno', 'codigoInterno') || fallback;
  }
  if (moduleMatches(modulo, 'ASEO')) {
    return normalizeAseoCode(textValue(data, 'codigo_interno', 'codigoInterno', 'codigo') || fallback);
  }
  if (moduleMatches(modulo, 'TALLER')) {
    return normalizeToolCode(textValue(data, 'codigo_principal', 'codigo', 'codigo_qr', 'codigo_interno', 'codigoInterno') || fallback);
  }
  return textValue(data, 'codigo_interno', 'codigoInterno', 'codigo', 'code') || fallback;
}

function displayCodeForMovement(data: Record<string, unknown>, modulo: string, fallback = '') {
  if (isChemicalModule(modulo)) {
    return textValue(data, 'codigo_original', 'codigoOriginal', 'codigo_excel', 'codigo', 'codigo_interno', 'codigoInterno') || fallback;
  }
  if (moduleMatches(modulo, 'ASEO')) {
    return normalizeAseoCode(textValue(data, 'codigo_interno', 'codigoInterno', 'codigo') || fallback);
  }
  if (moduleMatches(modulo, 'TALLER')) {
    return normalizeToolCode(textValue(data, 'codigo_principal', 'codigo', 'codigo_qr', 'codigo_interno', 'codigoInterno') || fallback);
  }
  return textValue(data, 'codigo_interno', 'codigoInterno', 'codigo', 'codigo_interno_origen', 'codigo_original') || fallback;
}

function referenceForDisplay(reference: string, module: string) {
  if (!moduleMatches(module, 'Dotación')) return reference || 'N/A';
  const cleanReference = reference.trim();
  if (!cleanReference) return 'N/A';

  const tallaMatch = cleanReference.match(/\btalla\s*[:\-]?\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ0-9]+)/i);
  const rawSize = tallaMatch?.[1] || cleanReference.match(/\b(única|unica|xs|s|m|l|xl|xxl|xxxl|\d{1,3})\b/i)?.[1] || '';
  if (!rawSize) return cleanReference.split('|')[0].replace(/^[^-:]+[-:]\s*/i, '').trim() || 'N/A';

  const normalizedSize = normalize(rawSize);
  const size = normalizedSize === 'unica' ? 'Unica' : rawSize.toUpperCase();
  return `Talla: ${size}`;
}

function isLubricantesTallerItem(module: string, data: Record<string, unknown>) {
  if (!moduleMatches(module, 'TALLER')) return false;
  const categoria = normalize(textValue(data, 'categoria', 'subcategoria', 'submodulo', 'referencia') || '');
  return categoria.includes('lubricante');
}

function readInventoryDoc(doc: QueryDocumentSnapshot): InventoryItem {
  const data = doc.data();
  const modulo = textValue(data, 'modulo') || 'Sin módulo';
  const codigo = displayCodeForInventory(data, modulo, doc.id);
  const item = textValue(data, 'item', 'producto', 'nombre') || doc.id;
  const subcategoria = textValue(data, 'subcategoria', 'categoria', 'referencia', 'ref');
  const ubicacion = textValue(data, 'ubicacion');
  const referencia = isLubricantesTallerItem(modulo, data) || moduleMatches(modulo, 'Agroquimicos')
    ? ''
    : referenceForDisplay(textValue(data, 'referencia', 'ref', 'talla'), modulo);

  return {
    id: doc.id,
    valuationId: valuationDocumentId('existencias', doc.id),
    modulo,
    codigo,
    descripcion: item,
    referencia,
    categoria: textValue(data, 'categoria') || 'General',
    unidad: textValue(data, 'unidad') || 'Unidad',
    saldo: numberValue(data, 'cantidad', 'stock_actual', 'stock', 'saldo'),
    estado: textValue(data, 'estado'),
    ubicacion,
    subcategoria: subcategoria || 'Sin subcategoría',
    marca: textValue(data, 'marca', 'brand'),
    expirationDate: dateTextValue(data, 'fecha_vencimiento', 'fechaVencimiento', 'vencimiento'),
    confirmedObsolete: normalize(textValue(data, 'estado_obsolescencia', 'estadoObsolescencia')) === 'obsoleto confirmado'
      || data.obsoleto_confirmado === true,
  };
}

function readAseoDoc(doc: QueryDocumentSnapshot): InventoryItem {
  const data = doc.data();
  const codigo = normalizeAseoCode(textValue(data, 'codigo_interno') || doc.id);
  const piso = textValue(data, 'piso');
  const pisoTexto = piso.padStart(2, '0');

  return {
    id: `aseo-${doc.id}`,
    valuationId: valuationDocumentId('productos_aseo', doc.id),
    modulo: 'ASEO',
    codigo,
    descripcion: textValue(data, 'producto', 'item', 'nombre') || doc.id,
    referencia: piso ? `Piso ${pisoTexto}` : 'Productos de aseo',
    categoria: textValue(data, 'categoria') || 'Productos de aseo',
    subcategoria: textValue(data, 'subcategoria'),
    marca: textValue(data, 'marca', 'brand'),
    unidad: textValue(data, 'unidad') || 'Unidad',
    saldo: numberValue(data, 'stock_actual'),
    estado: textValue(data, 'estado'),
    expirationDate: dateTextValue(data, 'fecha_vencimiento', 'fechaVencimiento', 'vencimiento'),
    confirmedObsolete: normalize(textValue(data, 'estado_obsolescencia', 'estadoObsolescencia')) === 'obsoleto confirmado'
      || data.obsoleto_confirmado === true,
  };
}

function agrochemicalLotEntryAssignments(data: Record<string, unknown>) {
  return Array.isArray(data.asignaciones_entrada)
    ? data.asignaciones_entrada.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const assignment = entry as Record<string, unknown>;
      const entryId = textValue(assignment, 'entrada_id', 'movimiento_id');
      const quantity = numberValue(assignment, 'cantidad');
      return entryId && quantity > 0 ? [{ entryId, quantity }] : [];
    })
    : [];
}

function readAgrochemicalLotDoc(doc: QueryDocumentSnapshot): AgrochemicalLot {
  const data = doc.data();
  return {
    id: doc.id,
    productDocumentId: doc.ref.parent.parent?.id || textValue(data, 'producto_id', 'documento_id'),
    productCode: textValue(data, 'codigo_producto', 'codigo_interno', 'codigo'),
    productName: textValue(data, 'producto', 'item', 'nombre'),
    lotNumber: textValue(data, 'numero_lote', 'lote', 'numeroLote') || doc.id,
    expirationDate: dateTextValue(data, 'fecha_vencimiento', 'fechaVencimiento', 'vencimiento'),
    quantity: numberValue(data, 'cantidad_disponible', 'cantidad', 'saldo', 'stock_actual'),
    initialQuantity: numberValue(data, 'cantidad_inicial', 'cantidad_entrada', 'cantidad'),
    unit: textValue(data, 'unidad') || 'Unidad',
    location: textValue(data, 'ubicacion'),
    receivedAt: dateTextValue(data, 'fecha_ingreso', 'fecha_entrada', 'createdAt', 'creado_en'),
    entryAssignments: agrochemicalLotEntryAssignments(data),
  };
}

function readToolDoc(doc: QueryDocumentSnapshot): InventoryItem {
  const data = doc.data();
  const estado = textValue(data, 'estado') || 'Disponible';
  const marca = textValue(data, 'marca');
  const subcategoria = textValue(data, 'subcategoria', 'referencia', 'ref');
  const tipo = textValue(data, 'tipo', 'tipo_herramienta');
  const tamano = textValue(data, 'tamano');
  const codigoRaw = textValue(data, 'codigo_principal', 'codigo', 'codigo_interno', 'clave') || doc.id;
  const codigo = normalizeToolCode(codigoRaw);
  const codigoQr = extraerNumeroQr(codigoRaw, textValue(data, 'codigo_qr', 'codigoQr', 'qr'));
  const disponible = numberValue(data, 'cantidad_disponible', 'disponibles');
  const total = numberValue(data, 'cantidad_total', 'stock_total', 'cantidad');
  const ocupado = numberValue(data, 'cantidad_ocupada', 'ocupados');
  const totalCalculado = total > 0 ? total : Math.max(disponible + ocupado, 0);
  const disponiblesCalculado = disponible > 0 || total > 0
    ? (disponible > 0 ? disponible : Math.max(totalCalculado - ocupado, 0))
    : 0;
  const caracteristica = [tipo, tamano].filter(Boolean).join(' / ') || 'Sin característica';
  const submodulo = resolverSubmoduloDesdeCampos({
    submoduloTaller: textValue(data, 'submodulo_taller', 'submodulo'),
    categoria: textValue(data, 'categoria'),
    ubicacion: textValue(data, 'ubicacion'),
    seccion: textValue(data, 'seccion', 'area', 'zona'),
  });

  return {
    id: `herramienta-${doc.id}`,
    valuationId: valuationDocumentId('herramientas', doc.id),
    modulo: textValue(data, 'modulo') || 'Taller',
    codigo,
    descripcion: textValue(data, 'nombre', 'item', 'producto') || doc.id,
    referencia: [subcategoria, tipo, tamano, marca].filter(Boolean).join(' - ') || 'N/A',
    marca,
    categoria: submodulo,
    unidad: textValue(data, 'unidad') || 'Unidad',
    saldo: disponiblesCalculado,
    estado,
    subcategoria: subcategoria || 'Sin subcategoría',
    caracteristica,
    total: totalCalculado,
    ocupados: ocupado,
    requiereQr: Boolean(data.requiere_asignar_qr) || codigo.startsWith('SINQR'),
    codigoQr,
    responsable: textValue(data, 'responsable'),
    expirationDate: dateTextValue(data, 'fecha_vencimiento', 'fechaVencimiento', 'vencimiento'),
    confirmedObsolete: normalize(textValue(data, 'estado_obsolescencia', 'estadoObsolescencia')) === 'obsoleto confirmado'
      || data.obsoleto_confirmado === true,
  };
}

function fallbackTool(codigo: string, subcategoria: string, descripcion: string, caracteristica: string, saldo: number, unidad = 'UNIDAD'): InventoryItem {
  return {
    id: `fallback-${codigo}`,
    valuationId: valuationDocumentId('catalogo_respaldo', codigo),
    modulo: 'Taller',
    codigo,
    descripcion,
    referencia: `${subcategoria} - ${caracteristica}`,
    categoria: 'HERRAMIENTAS TALLER',
    unidad,
    saldo,
    estado: 'Disponible',
    subcategoria,
    caracteristica,
    total: saldo,
    ocupados: 0,
    requiereQr: codigo.startsWith('SINQR'),
  };
}

const fallbackTools: InventoryItem[] = [
  fallbackTool('SINQR-HT-001', 'ALICATES Y PINZAS', 'ALICATE NEGRO', 'ALICATE / GRANDE', 4),
  fallbackTool('SINQR-HT-002', 'ALICATES Y PINZAS', 'ALICATE AMARILLO', 'ALICATE / GRANDE', 1),
  fallbackTool('SINQR-HT-003', 'ALICATES Y PINZAS', 'ALICATE NEGRO', 'ALICATE / PEQUENO', 1),
  fallbackTool('SINQR-HT-018', 'ALICATES Y PINZAS', 'PINZA PARA PIN REDONDO', 'PINZA / GRANDE', 5),
  fallbackTool('SINQR-HT-019', 'ALICATES Y PINZAS', 'PINZA PARA PIN REDONDO', 'PINZA / MEDIANA', 5),
  fallbackTool('SINQR-HT-004', 'DESTORNILLADORES', 'DESTORNILLADOR AZUL DE PALA', 'PALA / GRANDE', 3),
  fallbackTool('SINQR-HT-005', 'DESTORNILLADORES', 'DESTORNILLADOR AZUL DE PALA', 'PALA / MEDIANO', 2),
  fallbackTool('SINQR-HT-006', 'DESTORNILLADORES', 'DESTORNILLADOR AZUL DE PALA', 'PALA / PEQUENO', 1),
  fallbackTool('SINQR-HT-007', 'DESTORNILLADORES', 'DESTORNILLADOR AZUL DE ESTRELLA', 'ESTRELLA / GRANDE', 4),
  fallbackTool('SINQR-HT-008', 'DESTORNILLADORES', 'DESTORNILLADOR AZUL DE ESTRELLA', 'ESTRELLA / MEDIANO', 1),
  fallbackTool('SINQR-HT-009', 'DESTORNILLADORES', 'DESTORNILLADOR AZUL DE ESTRELLA', 'ESTRELLA / PEQUENO', 1),
  fallbackTool('SINQR-HT-010', 'LLAVES MANUALES', 'LLAVES MANUALES MILIMETRICAS', 'JUEGO DE LLAVES / VARIOS / #8 AL #1 1/2', 1, 'JUEGO'),
  fallbackTool('SINQR-HT-012', 'LLAVES MANUALES', 'LLAVE DE TUBO', 'LLAVE DE TUBO / GRANDE', 1),
  fallbackTool('SINQR-HT-013', 'LLAVES MANUALES', 'LLAVE DE TUBO', 'LLAVE DE TUBO / PEQUENA', 1),
  fallbackTool('SINQR-HT-014', 'LLAVES MANUALES', 'LLAVE EXPANSIVA', 'LLAVE EXPANSIVA / GRANDE', 4),
  fallbackTool('SINQR-HT-015', 'LLAVES MANUALES', 'LLAVE EXPANSIVA', 'LLAVE EXPANSIVA / PEQUENA', 1),
  fallbackTool('SINQR-HT-016', 'LLAVES BRISTOL Y COPAS', 'JUEGO DE LLAVES BRISTOL', 'BRISTOL / GRANDE', 2, 'JUEGO'),
  fallbackTool('SINQR-HT-017', 'LLAVES BRISTOL Y COPAS', 'JUEGO DE LLAVES BRISTOL', 'BRISTOL / PEQUENA', 1, 'JUEGO'),
  fallbackTool('QR-106', 'LLAVES BRISTOL Y COPAS', 'JUEGO DE COPAS FORCE', 'COPAS / FORCE', 1, 'JUEGO'),
  fallbackTool('QR-107', 'LLAVES BRISTOL Y COPAS', 'JUEGO DE COPAS STANLEY', 'COPAS / STANLEY', 1, 'JUEGO'),
  fallbackTool('QR-269', 'LLAVES BRISTOL Y COPAS', 'JUEGO DE COPAS STANLEY', 'COPAS / STANLEY', 1, 'JUEGO'),
  fallbackTool('SINQR-HT-011', 'SUJECION Y PRESION', 'HOMBRE SOLO', 'HOMBRE SOLO / GRANDE', 2),
  fallbackTool('SINQR-HT-020', 'SUJECION Y PRESION', 'DIABLO NEGRO', 'DIABLO / GRANDE', 2),
  fallbackTool('SINQR-HT-021', 'SUJECION Y PRESION', 'DIABLO AMARILLO', 'DIABLO / GRANDE', 1),
  fallbackTool('SINQR-HT-022', 'CORTE, GOLPE Y CINCELADO', 'SERRUCHO', 'SERRUCHO / GRANDE', 1),
  fallbackTool('SINQR-HT-023', 'CORTE, GOLPE Y CINCELADO', 'SEGUETA', 'SEGUETA / GRANDE', 1),
  fallbackTool('SINQR-HT-024', 'CORTE, GOLPE Y CINCELADO', 'JUEGO DE CINCELES DE ACERO MILIMETRICOS', 'CINCEL / VARIOS / #6 AL #13', 1, 'JUEGO'),
  fallbackTool('SINQR-HT-025', 'CORTE, GOLPE Y CINCELADO', 'MARTILLO', 'MARTILLO / GRANDE', 1),
  fallbackTool('QR-104', 'KITS DE ROSCA', 'KIT DE ROSCA EXTERNA', 'ROSCA EXTERNA', 1, 'KIT'),
  fallbackTool('QR-105', 'KITS DE ROSCA', 'KIT DE ROSCA INTERNA', 'ROSCA INTERNA', 1, 'KIT'),
  fallbackTool('QR-912', 'HERRAMIENTAS ELECTRICAS', 'TALADRO INALAMBRICO', 'TALADRO', 1),
  fallbackTool('QR-250', 'HERRAMIENTAS ELECTRICAS', 'TALADRO ELECTRICO', 'TALADRO', 1),
  fallbackTool('QR-249', 'HERRAMIENTAS ELECTRICAS', 'PULIDORA DEWALT', 'PULIDORA / GRANDE / DEWALT', 1),
  fallbackTool('QR-248', 'HERRAMIENTAS ELECTRICAS', 'PULIDORA DEWALT', 'PULIDORA / PEQUENA / DEWALT', 1),
  fallbackTool('QR-914', 'HERRAMIENTAS ELECTRICAS', 'TROZADORA DEWALT', 'TROZADORA / GRANDE / DEWALT', 1),
  fallbackTool('QR-103', 'HERRAMIENTAS ELECTRICAS', 'POLICHADORA BAUKER', 'POLICHADORA / BAUKER', 1),
  fallbackTool('QR-416', 'HERRAMIENTAS ELECTRICAS', 'PISTOLA DE IMPACTO', 'PISTOLA DE IMPACTO', 1),
  fallbackTool('QR-1007', 'HERRAMIENTAS ELECTRICAS', 'MOTOSIERRA ELECTRICA AZUL', 'MOTOSIERRA ELECTRICA / PEQUENA', 1),
  fallbackTool('QR-1023', 'HERRAMIENTAS ELECTRICAS', 'GRAPADORA', 'GRAPADORA', 1),
  fallbackTool('QR-494', 'EQUIPOS DE TALLER', 'SOPLADOR AMARILLO', 'SOPLADOR', 1),
  fallbackTool('QR-956', 'EQUIPOS DE TALLER', 'EQUIPO SOLDADURA NEXT INVERSOR INV9200', 'SOLDADURA / NEXT / INV9200', 1),
  fallbackTool('QR-58', 'EQUIPOS DE TALLER', 'COMPRESOR WOLFOX ROJO', 'COMPRESOR / PEQUENO / WOLFOX', 1),
  fallbackTool('QR-185', 'EQUIPOS DE TALLER', 'COMPRESOR ROJO', 'COMPRESOR / GRANDE', 1),
  fallbackTool('QR-916', 'EQUIPOS DE TALLER', 'ESMERIL TRUPER', 'ESMERIL / TRUPER', 1),
  fallbackTool('QR-271', 'EQUIPOS DE TALLER', 'INYECTOR FERTON AMARILLO', 'INYECTOR / GRANDE / FERTON', 1),
  fallbackTool('QR-108', 'EQUIPOS DE TALLER', 'OXICORTE AZUL', 'OXICORTE / GRANDE', 1),
  fallbackTool('QR-948', 'HIDRAULICOS Y SUMINISTRO', 'GATO HIDRAULICO ROJO', 'GATO HIDRAULICO / GRANDE', 1),
  fallbackTool('SINQR-HT-026', 'HIDRAULICOS Y SUMINISTRO', 'GATO HIDRAULICO AZUL', 'GATO HIDRAULICO', 1),
  fallbackTool('SINQR-HT-027', 'HIDRAULICOS Y SUMINISTRO', 'BOMBA DE SUMINISTRO ACPM', 'BOMBA DE SUMINISTRO / ACPM', 1),
];

function visibleToolInventory(currentTools: InventoryItem[], usingOfflineFallback: boolean) {
  if (currentTools.length > 0) return currentTools;
  return usingOfflineFallback ? fallbackTools : [];
}

function readMovementDoc(doc: QueryDocumentSnapshot): Movement {
  const data = doc.data();
  const modulo = textValue(data, 'modulo') || 'Sin módulo';
  const tipo = textValue(data, 'tipoMovimiento', 'tipo', 'movimiento') || 'Movimiento';

  const movement: Movement = {
    destinationLot: textValue(data, 'lote_destino', 'loteDestino', 'lote_aplicacion', 'loteAplicacion'),
    monthlyOccurredAt: data.fecha instanceof Timestamp ? data.fecha.toDate().toISOString() : undefined,
    id: doc.id,
    modulo,
    tipo,
    codigo: displayCodeForMovement(
      data,
      modulo,
      textValue(data, 'codigo_interno', 'codigoInterno', 'documento_id', 'producto_id', 'herramienta_clave', 'herramientaId'),
    ),
    descripcion: textValue(data, 'item', 'producto', 'herramientaNombre') || 'Sin descripción',
    referencia: referenceForDisplay(textValue(data, 'referencia', 'ref', 'talla'), modulo),
    cantidad: numberValue(data, 'cantidad'),
    unidad: textValue(data, 'unidad') || 'Unidad',
    fecha: dateTextValue(data, 'fecha', 'createdAt') || '',
    solicitante: textValue(data, 'solicitante') || textValue(data, 'responsable'),
    cargo: textValue(data, 'cargo'),
    usuario: textValue(data, 'usuario', 'registradoPor', 'usuario_uid'),
    observaciones: textValue(data, 'observaciones', 'nota'),
    fotoUrl: textValue(data, 'fotoUrl', 'foto_url', 'evidenciaUrl', 'evidencia_url', 'evidencia', 'photoUrl', 'photo_url'),
    submodulo: resolverSubmoduloDesdeCampos({
      submoduloTaller: textValue(data, 'submodulo_taller', 'submodulo', 'categoria'),
      categoria: textValue(data, 'categoria'),
      ubicacion: textValue(data, 'ubicacion'),
      seccion: textValue(data, 'seccion'),
    }),
    submoduloOrigen: (() => {
      const raw = textValue(data, 'submodulo_origen');
      return raw ? normalizarSubmoduloTaller(raw) : undefined;
    })(),
    maquinaria: (() => {
      const raw = textValue(data, 'maquinaria', 'equipo', 'maquina', 'vehiculo') ||
                  findValueByKeyPart(data, ['maquin', 'equipo', 'maq']);
      if (!raw) return undefined;
      // Para Taller normalizamos, para Combustible y otros usamos el valor tal cual
      if (moduleMatches(modulo, 'TALLER')) {
        return normalizarSubmoduloTaller(raw);
      }
      return raw;
    })(),
    zona: textValue(data, 'zona_ejecucion', 'zona') || findValueByKeyPart(data, ['zona', 'ejecucion']),
    labor: textValue(data, 'tipo_labor', 'labor', 'frente') || findValueByKeyPart(data, ['labor', 'frente', 'actividad', 'obra']),
    frente: textValue(data, 'frente', 'labor_frente', 'frente_trabajo') || findValueByKeyPart(data, ['frente', 'frent']),
    horometro: textValue(data, 'horometro', 'horómetro', 'horomet', 'horas', 'lectura_horometro', 'horometro_maquinaria') || findValueByKeyPart(data, ['horom', 'horas', 'lectura', 'horomet']),
    responsableEntrega: textValue(data, 'responsable_entrega', 'registradoPor'),
    ubicacion: textValue(data, 'ubicacion'),
    productDocumentId: textValue(data, 'producto_id', 'documento_id', 'herramientaId', 'herramienta_clave') || undefined,
    documentId: textValue(data, 'documento_id') || undefined,
    lote: textValue(data, 'numero_lote', 'lote', 'numeroLote'),
    fechaVencimiento: dateTextValue(data, 'fecha_vencimiento', 'fechaVencimiento', 'vencimiento'),
    lotesSalida: leerLotesSalidaReporte(data),
    stockBefore: optionalNumberValue(data, 'stock_anterior'),
    stockAfter: optionalNumberValue(data, 'stock_nuevo'),
  };

  return movement;
}

function readUserDoc(doc: QueryDocumentSnapshot): UserProfile {
  const data = doc.data();
  const nombres = textValue(data, 'nombres', 'nombre', 'displayName');
  const apellidos = textValue(data, 'apellidos', 'apellido');
  const nombre = [nombres, apellidos].filter(Boolean).join(' ').trim();

  return {
    id: doc.id,
    nombre: nombre || textValue(data, 'email') || doc.id,
    cargo: textValue(data, 'cargo', 'rol'),
    email: textValue(data, 'email'),
    rol: textValue(data, 'rol', 'role'),
    estado: textValue(data, 'estado'),
    activo: data.activo === true,
  };
}

function statusFor(item: InventoryItem, overrideEstado?: string) {
  if (moduleMatches(item.modulo, 'TALLER')) {
    if (item.requiereQr) {
      const occ = item.ocupados ?? 0;
      if (occ > 0) return { label: 'En uso', className: 'warning' };
      return { label: 'Disponible', className: 'ok' };
    }
    const estado = overrideEstado ?? item.estado;
    if (estado) {
      const normalized = normalize(estado);
      if (normalized.includes('disponible')) return { label: estado, className: 'ok' };
      if (normalized.includes('uso') || normalized.includes('prest')) return { label: estado, className: 'warning' };
      if (normalized.includes('mant')) return { label: estado, className: 'danger' };
      return { label: estado, className: 'notice' };
    }
  }
  if (item.saldo <= 0) return { label: 'Sin stock', className: 'danger' };
  if (item.saldo <= 3) return { label: 'Crítico', className: 'warning' };
  if (item.saldo <= 10) return { label: 'Bajo', className: 'notice' };
  return { label: 'Disponible', className: 'ok' };
}

function compareCodes(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function isEntry(movement: Movement) {
  return normalize(movement.tipo).includes('entrada') || normalize(movement.tipo).includes('ingreso');
}

function isExit(movement: Movement) {
  const tipo = normalize(movement.tipo);
  return tipo.includes('salida') || tipo.includes('entrega') || tipo.includes('traslado') || tipo.includes('consumo');
}

function movementIsEntry(movement: Movement, tallerSubmodulo: string) {
  if (tallerSubmodulo) return esEntradaVistaTaller(movement, tallerSubmodulo);
  return isEntry(movement);
}

function movementIsExit(movement: Movement, tallerSubmodulo: string) {
  if (tallerSubmodulo) return esSalidaVistaTaller(movement, tallerSubmodulo);
  return isExit(movement);
}

function reconcileKey(modulo: string, codigo: string, descripcion: string, referencia: string) {
  const mod = normalizeModule(modulo || 'sinmodulo');
  const code = codigo.trim();
  if (code && code.toLowerCase() !== 'sin código') return `${mod}::${normalize(code)}`;
  const desc = normalize(descripcion);
  const ref = normalize(referencia);
  if (desc) return `${mod}::${desc}|${ref}`;
  return `${mod}::${ref || 'sinreferencia'}`;
}

function inventoryLookupKeys(item: InventoryItem) {
  const keys = [
    reconcileKey(item.modulo, item.codigo, item.descripcion, item.referencia),
    reconcileKey(item.modulo, item.codigo, item.descripcion, ''),
    reconcileKey(item.modulo, item.codigo, '', ''),
    reconcileKey(item.modulo, '', item.descripcion, item.referencia),
  ];
  return [...new Set(keys)];
}

function movementLookupKeys(movement: Movement) {
  const keys = [
    reconcileKey(movement.modulo, movement.codigo, movement.descripcion, movement.referencia),
    reconcileKey(movement.modulo, movement.codigo, movement.descripcion, ''),
    reconcileKey(movement.modulo, movement.codigo, '', ''),
    reconcileKey(movement.modulo, '', movement.descripcion, movement.referencia),
  ];
  return [...new Set(keys)];
}

function inventoryItemForReport(item: InventoryItem): InventarioParaReporte {
  return {
    id: item.id,
    modulo: item.modulo,
    codigo: item.codigo,
    descripcion: item.descripcion,
    referencia: item.referencia,
    unidad: item.unidad,
    saldo_actual: item.saldo,
    submodulo: item.categoria,
    codigos_alternos: item.codigoQr ? [item.codigoQr] : undefined,
    ubicacion: item.ubicacion,
  };
}

function inventoryReportFingerprint(items: InventoryItem[]) {
  return JSON.stringify(
    [...items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => [
        item.id,
        item.modulo,
        item.codigo,
        item.codigoQr ?? '',
        item.descripcion,
        item.referencia,
        item.unidad,
        item.saldo,
        item.categoria,
      ]),
  );
}

function buildTotals(movements: Movement[], tallerSubmodulo = ''): Totals {
  return movements.reduce<Totals>((acc, movement) => {
    const key = reconcileKey(movement.modulo, movement.codigo, movement.descripcion, movement.referencia);
    const current = acc[key] ?? { entradas: 0, salidas: 0 };
    if (movementIsEntry(movement, tallerSubmodulo)) current.entradas += movement.cantidad;
    if (movementIsExit(movement, tallerSubmodulo)) current.salidas += movement.cantidad;
    acc[key] = current;
    return acc;
  }, {});
}

function lookupTotals(keys: string[], totals: Totals) {
  for (const key of keys) {
    const found = totals[key];
    if (found) return found;
  }
  return { entradas: 0, salidas: 0 };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(value);
}

const FUEL_TYPES = ['Gasolina', 'ACPM', 'Urea'] as const;

function fuelTypeFromItem(item: InventoryItem): (typeof FUEL_TYPES)[number] | null {
  const haystack = normalize(`${item.descripcion} ${item.referencia} ${item.subcategoria ?? ''} ${item.categoria}`);
  const match = FUEL_TYPES.find((tipo) => {
    const key = normalize(tipo);
    return haystack.includes(key) || (haystack.includes('liquido') && haystack.includes(key));
  });
  return match ?? null;
}

function combustibleStockByType(inventory: InventoryItem[]) {
  const stock: Record<(typeof FUEL_TYPES)[number], number> = { Gasolina: 0, ACPM: 0, Urea: 0 };
  inventory.forEach((item) => {
    const tipo = fuelTypeFromItem(item);
    if (tipo) stock[tipo] += item.saldo;
  });
  return stock;
}

function balanceTone(value: number): 'ok' | 'warning' | 'danger' {
  if (value <= 0) return 'danger';
  if (value <= 3) return 'warning';
  return 'ok';
}

function balanceClassName(value: number) {
  return `numeric balance balance-${balanceTone(value)}`;
}

function formatSyncLabel(value: string) {
  if (!value) return 'Sin sincronizar';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function canPreviewEvidence(url: string) {
  return /^https?:\/\//i.test(url) || /^data:image\//i.test(url);
}

function formatDateKey(date: Date) {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(date: Date) {
  const key = formatDateKey(date);
  if (!key) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${key} ${hours}:${minutes}`;
}

function dateTextValue(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return formatDateTime(new Date(value < 1_000_000_000_000 ? value * 1000 : value));
    if (value instanceof Date) return formatDateTime(value);
    if (value && typeof value === 'object') {
      const maybeTimestamp = value as { toDate?: () => Date; seconds?: number };
      if (typeof maybeTimestamp.toDate === 'function') return formatDateTime(maybeTimestamp.toDate());
      if (typeof maybeTimestamp.seconds === 'number') return formatDateTime(new Date(maybeTimestamp.seconds * 1000));
    }
  }
  return '';
}

function userDisplayName(rawUser: string, users: Record<string, UserProfile>) {
  const value = rawUser.trim();
  if (!value) return '';

  const profile = users[value];
  if (profile) {
    const firstName = profile.nombre.split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
    return [firstName || profile.email, profile.cargo].filter(Boolean).join(' ');
  }

  return value;
}

function movementPersonText(movement: Movement, users: Record<string, UserProfile>) {
  return [
    movement.solicitante,
    movement.cargo,
    movement.usuario,
    userDisplayName(movement.usuario, users),
  ].filter(Boolean).join(' ');
}

function totalsForItem(item: InventoryItem, totals: Totals) {
  return lookupTotals(inventoryLookupKeys(item), totals);
}

function latestExitForItem(movements: Movement[], item: InventoryItem) {
  const keys = new Set(inventoryLookupKeys(item));
  return movements
    .filter((movement) => isExit(movement) && movementLookupKeys(movement).some((key) => keys.has(key)))
    .sort((left, right) => (
      (right.fecha || '').localeCompare(left.fecha || '')
      || left.id.localeCompare(right.id)
    ))[0];
}

function expandTallerOccupiedUnits(items: InventoryItem[], movements: Movement[]): OccupiedUnitCard[] {
  const cards: OccupiedUnitCard[] = [];

  items.forEach((item) => {
    const unitTotal = Math.max(0, Math.floor(item.ocupados ?? 0));
    if (unitTotal <= 0) return;

    const latestExit = latestExitForItem(movements, item);
    const solicitante = latestExit?.solicitante || item.responsable || 'Sin responsable';
    const submodulo = normalizarSubmoduloTaller(item.categoria);

    for (let index = 0; index < unitTotal; index += 1) {
      cards.push({
        id: `${item.id}-occ-${index + 1}`,
        submodulo,
        codigo: item.codigoQr || item.codigo,
        descripcion: item.descripcion,
        subcategoria: item.subcategoria,
        caracteristica: item.caracteristica,
        solicitante,
        unitIndex: index + 1,
        unitTotal,
      });
    }
  });

  return cards;
}

function groupOccupiedBySubmodule(units: OccupiedUnitCard[]): OccupiedSubmoduleGroup[] {
  const grouped = new Map<string, OccupiedUnitCard[]>();
  units.forEach((unit) => {
    const list = grouped.get(unit.submodulo) ?? [];
    list.push(unit);
    grouped.set(unit.submodulo, list);
  });

  const ordered: OccupiedSubmoduleGroup[] = TALLER_SUBMODULOS
    .map((submodulo) => ({ submodulo, items: grouped.get(submodulo) ?? [] }))
    .filter((group) => group.items.length > 0);

  grouped.forEach((items, submodulo) => {
    if (!TALLER_SUBMODULOS.some((entry) => entry === submodulo)) {
      ordered.push({ submodulo, items });
    }
  });

  return ordered;
}

function reconcileInventoryWithMovements(stockItems: InventoryItem[], _movements: Movement[]): InventoryItem[] {
  // Saldo = valor en Firestore. La app Android actualiza existencias / productos_aseo / herramientas
  // en cada movimiento. Los totales de entradas/salidas en la tabla son solo informativos.
  return stockItems;
}

function LoginScreen({
  onLogin,
  onRegister,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, name: string, jobTitle: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'register') {
        await onRegister(email, password, name, jobTitle);
      } else {
        await onLogin(email, password);
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'AUTH_CORPORATE_EMAIL_REQUIRED') {
        setError('Solo se aceptan correos corporativos terminados en @arlessas.com.');
      } else if (err instanceof Error && err.message === 'AUTH_REGISTRATION_PENDING') {
        setMode('login');
        setError('Cuenta pendiente de aprobación. Un administrador debe confirmar tu perfil antes de permitir el acceso.');
      } else if (err instanceof Error && err.message === 'AUTH_REGISTRATION_PROFILE_FAILED') {
        setError('No se pudo completar el perfil de la cuenta. Intenta nuevamente; el correo no debería quedar bloqueado.');
      } else if (err instanceof Error && err.message === 'AUTH_REGISTRATION_DETAILS_REQUIRED') {
        setError('Escribe el nombre y el cargo para crear la cuenta.');
      } else if (mode === 'register') {
        setError('No pude crear la cuenta. El correo puede ya estar registrado o la contraseña no cumplir los requisitos.');
      } else {
        setError('No pude iniciar sesión. Revisa el correo, la clave o permisos del usuario.');
      }
    } finally {
      setLoading(false);
    }
  }

  function changeMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError('');
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <img src={logoSrc} alt={brandName} className="login-logo" />
        <div>
          <p className="eyebrow">Panel web</p>
          <h1>{brandName}</h1>
          <h2 className="login-title-sub">Gestión de almacén</h2>
          <p className="login-copy">
            {mode === 'register'
              ? 'Crea tu cuenta corporativa. Un administrador deberá autorizar tu acceso al panel.'
              : 'Conexión directa a Firestore para revisar inventario, entradas y salidas.'}
          </p>
        </div>
        <form onSubmit={submit} className="login-form">
          {mode === 'register' && <label>Nombre completo<input value={name} onChange={(event) => setName(event.target.value)} type="text" autoComplete="name" required /></label>}
          {mode === 'register' && <label>Cargo<input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} type="text" autoComplete="organization-title" required /></label>}
          <label>
            Correo
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="nombre@arlessas.com" required />
          </label>
          <label>
            Contraseña
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={6} required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? (mode === 'register' ? 'Creando cuenta...' : 'Ingresando...') : mode === 'register' ? 'Crear cuenta' : 'Ingresar'}
          </button>
        </form>
        <div className="login-mode-switch" aria-live="polite">
          <span>{mode === 'register' ? '¿Ya tienes una cuenta?' : '¿Aún no tienes una cuenta?'}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => changeMode(mode === 'register' ? 'login' : 'register')}
            disabled={loading}
          >
            {mode === 'register' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </div>
      </section>
    </main>
  );
}

const APPROVABLE_ROLES = ['operador', 'almacenista', 'administrador'] as const;
const EDITABLE_USER_STATES = ['activo', 'inactivo'] as const;

function PendingUsersPanel({
  users,
  onClose,
  onSave,
}: {
  users: UserProfile[];
  onClose: () => void;
  onSave: (profile: UserProfile, role: string, name: string, jobTitle: string, state: string) => Promise<void>;
}) {
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [jobTitles, setJobTitles] = useState<Record<string, string>>({});
  const [selectedStates, setSelectedStates] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  async function save(profile: UserProfile) {
    const role = selectedRoles[profile.id] || 'operador';
    const name = names[profile.id]?.trim() || profile.email || profile.id;
    const jobTitle = jobTitles[profile.id]?.trim() || profile.cargo || '';
    const state = selectedStates[profile.id] || (profile.estado === 'pendiente' ? 'activo' : profile.estado || 'activo');
    setSavingId(profile.id);
    setError('');
    try {
      await onSave(profile, role, name, jobTitle, state);
    } catch {
      setError(`No se pudo guardar ${profile.email || profile.id}. Verifica los permisos y la conexión.`);
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="pending-panel-backdrop" role="presentation" onClick={onClose}>
      <section
        className="pending-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-panel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pending-panel-header">
          <div>
            <p className="eyebrow">Administración</p>
            <h2 id="pending-panel-title">Cuentas de usuarios</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar cuentas pendientes" title="Cerrar">
            <X size={18} />
          </button>
        </header>

        {error && <p className="form-error">{error}</p>}

        {users.length === 0 ? (
          <div className="pending-empty">
            <UserCheck size={26} />
            <strong>No hay cuentas registradas</strong>
            <span>Las nuevas cuentas corporativas aparecerán aquí.</span>
          </div>
        ) : (
          <div className="pending-users-list">
            {users.map((profile) => (
              <article className="pending-user-row" key={profile.id}>
                <div className="pending-user-identity">
                  <strong>{profile.email || profile.id}</strong>
                  <span><Clock3 size={13} /> {profile.estado === 'pendiente' ? 'Esperando autorización' : 'Cuenta establecida'}</span>
                </div>
                <label>
                  Nombre
                  <input
                    value={names[profile.id] ?? profile.nombre ?? ''}
                    onChange={(event) => setNames((current) => ({ ...current, [profile.id]: event.target.value }))}
                    placeholder="Nombre del usuario"
                  />
                </label>
                <label>
                  Cargo
                  <input
                    value={jobTitles[profile.id] ?? profile.cargo ?? ''}
                    onChange={(event) => setJobTitles((current) => ({ ...current, [profile.id]: event.target.value }))}
                    placeholder="Cargo del usuario"
                  />
                </label>
                <label>
                  Rol
                  <select
                    value={selectedRoles[profile.id] ?? profile.rol ?? 'operador'}
                    onChange={(event) => setSelectedRoles((current) => ({ ...current, [profile.id]: event.target.value }))}
                  >
                    {[...new Set([...APPROVABLE_ROLES, profile.rol].filter(Boolean))].map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </label>
                <label>
                  Estado
                  <select
                    value={selectedStates[profile.id] ?? (profile.estado === 'pendiente' ? 'activo' : profile.activo === false ? 'inactivo' : 'activo')}
                    onChange={(event) => setSelectedStates((current) => ({ ...current, [profile.id]: event.target.value }))}
                  >
                    {EDITABLE_USER_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => { void save(profile); }} disabled={savingId === profile.id}>
                  <UserCheck size={16} />
                  {savingId === profile.id ? 'Guardando...' : profile.estado === 'pendiente' ? 'Activar' : 'Guardar'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Render modal at the end of file to keep App function focused
// Note: placed here to avoid extra state lifting


function AppShell({ user }: { user: User }) {
  const cacheContext = useMemo(() => ({ uid: user.uid, projectId: firebaseProjectId }), [user.uid]);
  const [cachedPanelData] = useState(() => {
    const cached = loadPanelCache<InventoryItem>(window.localStorage, cacheContext);
    if (!cached) return null;
    return {
      ...cached,
      inventory: cached.inventory
        .filter((item) => !isHistoricalInventoryModule(item.modulo))
        .map(withValuationId),
      aseoInventory: cached.aseoInventory.map(withValuationId),
      tools: cached.tools.map(withValuationId),
    };
  });
  const [module, setModule] = useState<string>(inventoryValuationModule);
  const [search, setSearch] = useState('');
  const [inventory, setInventory] = useState<InventoryItem[]>(() => cachedPanelData?.inventory ?? []);
  const [aseoInventory, setAseoInventory] = useState<InventoryItem[]>(() => cachedPanelData?.aseoInventory ?? []);
  const [tools, setTools] = useState<InventoryItem[]>(() => cachedPanelData?.tools ?? []);
  const [agrochemicalLots, setAgrochemicalLots] = useState<AgrochemicalLot[]>([]);
  const [agrochemicalLotsLoading, setAgrochemicalLotsLoading] = useState(true);
  const [agrochemicalLotsError, setAgrochemicalLotsError] = useState('');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [hasMoreMovements, setHasMoreMovements] = useState(false);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false);
  const [movementHistoryError, setMovementHistoryError] = useState('');
  const [users, setUsers] = useState<Record<string, UserProfile>>({});
  const [showPendingUsers, setShowPendingUsers] = useState(false);
  const [valuations, setValuations] = useState<Record<string, number>>({});
  const [valuationRevisions, setValuationRevisions] = useState<Record<string, ManualValuationRevision>>({});
  const [valuationDocumentIds, setValuationDocumentIds] = useState<Set<string>>(() => new Set());
  const [entryStockMovements, setEntryStockMovements] = useState<EntryStockMovement[]>([]);
  const [entryValuationRecords, setEntryValuationRecords] = useState<Record<string, EntryValuationRecord>>({});
  const [firestoreSources, setFirestoreSources] = useState(createInitialFirestoreSourceStates);
  const [valuationDrafts, setValuationDrafts] = useState<Record<string, string>>({});
  const [valuationEditBaselines, setValuationEditBaselines] = useState<Record<string, ManualValuationRevision>>({});
  const [valuationConflicts, setValuationConflicts] = useState<Record<string, ManualValuationConflict>>({});
  const [valuationSaveStates, setValuationSaveStates] = useState<Record<string, ValuationSaveState>>({});
  const [valuationEditItem, setValuationEditItem] = useState<InventoryItem | null>(null);
  const [evidenceMovement, setEvidenceMovement] = useState<Movement | null>(null);
  const [showOccupiedModal, setShowOccupiedModal] = useState(false);
  const [showEntriesModal, setShowEntriesModal] = useState(false);
  const [showAgrochemicalExpirationModal, setShowAgrochemicalExpirationModal] = useState(false);
  const [exitDateFrom, setExitDateFrom] = useState('');
  const [exitDateTo, setExitDateTo] = useState('');
  const [exitCode, setExitCode] = useState('');
  const [exitPerson, setExitPerson] = useState('');
  const [exitItem, setExitItem] = useState('');
  const [exitFiltersOpen, setExitFiltersOpen] = useState(false);
  const [exitVisibleLimit, setExitVisibleLimit] = useState(24);
  const [tallerSubmodulo, setTallerSubmodulo] = useState('');
  const [agroquimicosUbicacion, setAgroquimicosUbicacion] = useState('');
  const [statusOrder, setStatusOrder] = useState<TallerStatusOrder>('default');
  const [tallerStatusState, setTallerStatusState] = useState(createInitialTallerStatusState);
  const [lastSync, setLastSync] = useState(() => cachedPanelData?.lastSync ?? '');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const wasFullyLive = useRef(false);
  const savingValuationIds = useRef(new Set<string>());
  const movementCursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const movementPaginationStartedRef = useRef(false);
  const loadingMovementPageRef = useRef(false);
  const autoLoadedEmptyMovementScopesRef = useRef(new Set<string>());
  const analysisHistoryLoadAttemptedRef = useRef(false);
  const valuationHistoryLoadAttemptedRef = useRef(false);
  const savingToolStatusIds = useRef(new Set<string>());
  const canExportMovementReport = browserPlatform.canExportMovementReport;
  const panelSourcesReady = areSourcesServerReady(firestoreSources, PANEL_REQUIRED_SOURCE_KEYS);
  const allSourcesReady = areSourcesServerReady(firestoreSources, FIRESTORE_SOURCE_KEYS);
  const hasCachedFirestoreSource = PANEL_REQUIRED_SOURCE_KEYS.some((key) => firestoreSources[key].fromCache);
  const usingCachedData = !panelSourcesReady && (Boolean(cachedPanelData) || hasCachedFirestoreSource);
  const loading = PANEL_REQUIRED_SOURCE_KEYS.some((key) => (
    !firestoreSources[key].received && !firestoreSources[key].error
  ));
  const valuationLoading = CLOSE_REQUIRED_SOURCE_KEYS.some((key) => (
    !firestoreSources[key].received && !firestoreSources[key].error
  ));
  const firestoreErrors = sourceErrorMessages(firestoreSources);

  function recordSourceSnapshot(
    source: FirestoreSourceKey,
    metadata: { fromCache: boolean; hasPendingWrites: boolean },
  ) {
    setFirestoreSources((current) => updateSourceFromSnapshot(current, source, metadata));
  }

  function recordSourceError(source: FirestoreSourceKey, message: string) {
    setFirestoreSources((current) => updateSourceWithError(current, source, message));
  }

  function movementPageQuery(cursor?: QueryDocumentSnapshot) {
    const source = collection(db, 'movimientos');
    if (cursor) {
      return query(
        source,
        orderBy('fecha', 'desc'),
        orderBy(documentId(), 'desc'),
        startAfter(cursor),
        firestoreLimit(MOVEMENT_PAGE_SIZE),
      );
    }
    return query(
      source,
      orderBy('fecha', 'desc'),
      orderBy(documentId(), 'desc'),
      firestoreLimit(MOVEMENT_PAGE_SIZE),
    );
  }

  function reportMovementPageQuery(cursor?: QueryDocumentSnapshot) {
    const source = collection(db, 'movimientos');
    if (cursor) {
      return query(
        source,
        orderBy(documentId(), 'asc'),
        startAfter(cursor),
        firestoreLimit(MOVEMENT_PAGE_SIZE),
      );
    }
    return query(source, orderBy(documentId(), 'asc'), firestoreLimit(MOVEMENT_PAGE_SIZE));
  }

  async function loadMoreMovementHistory() {
    if (loadingMovementPageRef.current || !movementCursorRef.current || !hasMoreMovements) return;
    loadingMovementPageRef.current = true;
    setLoadingMoreMovements(true);
    setMovementHistoryError('');
    try {
      const snapshot = await getDocsFromServer(movementPageQuery(movementCursorRef.current));
      const nextPage = snapshot.docs.map(readMovementDoc);
      movementPaginationStartedRef.current = true;
      setMovements((current) => mergeMovementPages(current, nextPage));
      movementCursorRef.current = snapshot.docs.at(-1) ?? movementCursorRef.current;
      setHasMoreMovements(movementPageHasMore(snapshot.size));
    } catch (loadError) {
      console.error('No se pudo cargar la siguiente página de movimientos:', loadError);
      setMovementHistoryError('No se pudo cargar más historial. Revisa la conexión e intenta nuevamente.');
    } finally {
      loadingMovementPageRef.current = false;
      setLoadingMoreMovements(false);
    }
  }

  async function loadCompleteMovementHistory() {
    if (loadingMovementPageRef.current) {
      throw new Error('Ya se está cargando una página del historial.');
    }
    loadingMovementPageRef.current = true;
    setLoadingMoreMovements(true);
    setMovementHistoryError('');
    let accumulated: Movement[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    let more = true;
    try {
      while (more) {
        const snapshot = await getDocsFromServer(reportMovementPageQuery(cursor));
        const nextPage = snapshot.docs.map(readMovementDoc);
        accumulated = mergeMovementPages(accumulated, nextPage);
        cursor = snapshot.docs.at(-1);
        more = movementPageHasMore(snapshot.size);
      }
      movementPaginationStartedRef.current = true;
      setMovements(accumulated);
      setHasMoreMovements(false);
      return accumulated;
    } catch (loadError) {
      console.error('No se pudo completar el historial para exportar:', loadError);
      setMovementHistoryError('No se pudo completar el historial. El reporte no fue generado para evitar datos parciales.');
      throw loadError;
    } finally {
      loadingMovementPageRef.current = false;
      setLoadingMoreMovements(false);
    }
  }

  useEffect(() => {
    const unsubscribeInventory = onSnapshot(
      collection(db, 'existencias'),
      { includeMetadataChanges: true },
      (snapshot) => {
        setInventory(
          snapshot.docs
            .map(readInventoryDoc)
            .filter((item) => !isHistoricalInventoryModule(item.modulo)),
        );
        recordSourceSnapshot('inventory', snapshot.metadata);
      },
      () => recordSourceError('inventory', 'No se pudo leer. Verifica que el usuario esté activo en Firebase.'),
    );

    const unsubscribeMovements = onSnapshot(
      movementPageQuery(),
      { includeMetadataChanges: true },
      (snapshot) => {
        const firstPage = snapshot.docs.map(readMovementDoc);
        setMovements((current) => (
          movementPaginationStartedRef.current
            ? mergeMovementPages(current, firstPage)
            : firstPage
        ));
        if (!movementPaginationStartedRef.current) {
          movementCursorRef.current = snapshot.docs.at(-1) ?? null;
          setHasMoreMovements(movementPageHasMore(snapshot.size));
        }
        recordSourceSnapshot('movements', snapshot.metadata);
      },
      () => recordSourceError('movements', 'No se pudo leer. Verifica permisos en Firebase.'),
    );

    const unsubscribeAseoInventory = onSnapshot(
      collection(db, 'productos_aseo'),
      { includeMetadataChanges: true },
      (snapshot) => {
        setAseoInventory(snapshot.docs.map(readAseoDoc));
        recordSourceSnapshot('aseo', snapshot.metadata);
      },
      () => recordSourceError('aseo', 'No se pudo leer. Verifica permisos en Firebase.'),
    );

    const unsubscribeTools = onSnapshot(
      collection(db, 'herramientas'),
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextTools = snapshot.docs.map(readToolDoc);
        setTools(nextTools);
        setTallerStatusState((current) => reconcileTallerStatusSnapshot(
          current,
          Object.fromEntries(nextTools.map((item) => [item.id, item.estado ?? ''])),
          !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites,
        ));
        recordSourceSnapshot('tools', snapshot.metadata);
      },
      () => recordSourceError('tools', 'No se pudo leer. Verifica permisos en Firebase.'),
    );

    const unsubscribeUsers = onSnapshot(
      collection(db, 'usuarios'),
      { includeMetadataChanges: true },
      (snapshot) => {
        const profiles = snapshot.docs.map(readUserDoc);
        const entries = profiles.flatMap((profile): Array<[string, UserProfile]> => (
          profile.email ? [[profile.id, profile], [profile.email, profile]] : [[profile.id, profile]]
        ));
        setUsers(Object.fromEntries(entries));
        recordSourceSnapshot('users', snapshot.metadata);
      },
      () => recordSourceError('users', 'No se pudo leer. Verifica permisos en Firebase.'),
    );

    const unsubscribeValuations = onSnapshot(
      collection(db, 'valoraciones_inventario'),
      { includeMetadataChanges: true },
      (snapshot) => {
        const entries = snapshot.docs.map((valuationDoc): [string, number] => {
          const value = numberValue(valuationDoc.data(), 'valor_unitario');
          return [valuationDoc.id, Math.max(value, 0)];
        });
        setValuations(Object.fromEntries(entries));
        setValuationRevisions(Object.fromEntries(snapshot.docs.map((valuationDoc) => [
          valuationDoc.id,
          valuationRevisionFromData(true, valuationDoc.data()),
        ])));
        setValuationDocumentIds(new Set(snapshot.docs.map((valuationDoc) => valuationDoc.id)));
        recordSourceSnapshot('valuations', snapshot.metadata);
      },
      () => recordSourceError('valuations', 'No se pudo leer. Verifica permisos en Firebase.'),
    );

    const unsubscribeEntryMovements = subscribeEntryStockMovements(
      (entries, metadata) => {
        setEntryStockMovements(entries);
        recordSourceSnapshot('entryMovements', metadata);
      },
      () => recordSourceError('entryMovements', 'No se pudo leer. Verifica permisos en Firebase.'),
    );

    const unsubscribeEntryValuations = subscribeEntryValuationRecords(
      (records, metadata) => {
        setEntryValuationRecords(records);
        recordSourceSnapshot('entryValuations', metadata);
      },
      () => recordSourceError('entryValuations', 'No se pudo leer. Verifica permisos en Firebase.'),
    );

    return () => {
      unsubscribeInventory();
      unsubscribeAseoInventory();
      unsubscribeMovements();
      unsubscribeTools();
      unsubscribeUsers();
      unsubscribeValuations();
      unsubscribeEntryMovements();
      unsubscribeEntryValuations();
    };
  }, []);

  useEffect(() => {
    setAgrochemicalLotsLoading(true);
    setAgrochemicalLotsError('');
    return onSnapshot(
      collectionGroup(db, 'lotes_agroquimicos'),
      (snapshot) => {
        setAgrochemicalLots(snapshot.docs.map(readAgrochemicalLotDoc));
        setAgrochemicalLotsLoading(false);
      },
      () => {
        setAgrochemicalLots([]);
        setAgrochemicalLotsError('No se pudieron leer los lotes de agroquímicos. Verifica permisos y conexión.');
        setAgrochemicalLotsLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    if (allSourcesReady && !wasFullyLive.current) {
      setLastSync(new Date().toISOString());
    }
    wasFullyLive.current = allSourcesReady;
  }, [allSourcesReady]);

  useEffect(() => {
    const cache = {
      inventory,
      aseoInventory,
      tools,
      lastSync,
    };
    if (hasPanelCacheData(cache)) {
      savePanelCache(window.localStorage, cacheContext, cache);
    }
  }, [aseoInventory, cacheContext, inventory, lastSync, tools]);

  const inventoryTableRef = useRef<HTMLDivElement>(null);

  function resetModuleViewState() {
    setExitDateFrom('');
    setExitDateTo('');
    setExitCode('');
    setExitPerson('');
    setExitItem('');
    setExitFiltersOpen(false);
    setTallerSubmodulo('');
    setAgroquimicosUbicacion('');
    setTallerStatusState(createInitialTallerStatusState());
    setSearch('');
    setStatusOrder('default');
    setValuationEditItem(null);
    setEvidenceMovement(null);
    setShowOccupiedModal(false);
    setShowEntriesModal(false);
    setShowAgrochemicalExpirationModal(false);
  }

  function selectModule(nextModule: string) {
    if (nextModule === module) return;
    resetModuleViewState();
    setModule(nextModule);
  }

  const canManageUsers = user.email?.toLowerCase() === 'almacen@arlessas.com'
    || ['owner', 'admin', 'administrador'].includes((users[user.uid]?.rol || users[user.email || '']?.rol || '').toLowerCase());

  const pendingUsers = useMemo(() => {
    const uniqueProfiles = new Map<string, UserProfile>();
    Object.values(users).forEach((profile) => {
      if (profile.rol === 'pendiente' || profile.estado === 'pendiente') {
        uniqueProfiles.set(profile.id, profile);
      }
    });
    return Array.from(uniqueProfiles.values()).sort((left, right) => left.email.localeCompare(right.email));
  }, [users]);

  async function saveUserProfile(profile: UserProfile, role: string, name: string, jobTitle: string, state: string) {
    const isActive = state === 'activo';
    await updateDoc(doc(db, 'usuarios', profile.id), {
      nombres: name,
      nombre: name,
      cargo: jobTitle,
      rol: role,
      activo: isActive,
      estado: isActive ? 'activo' : 'inactivo',
      ...(profile.estado === 'pendiente' ? { aprobadoEn: new Date().toISOString() } : {}),
    });
  }

  function selectTallerSubmodulo(nextSubmodulo: string) {
    setTallerSubmodulo(nextSubmodulo);
  }

  function selectAgroquimicosUbicacion(nextUbicacion: string) {
    setAgroquimicosUbicacion(nextUbicacion);
  }

  useEffect(() => {
    inventoryTableRef.current?.scrollTo({ top: 0 });
  }, [module, tallerSubmodulo, agroquimicosUbicacion]);

  function toolDocumentId(item: InventoryItem) {
    return item.id.startsWith('herramienta-') ? item.id.replace(/^herramienta-/, '') : undefined;
  }

  function statusValueForItem(item: InventoryItem) {
    return effectiveTallerStatus(tallerStatusState, item.id, item.estado ?? '');
  }

  async function toggleTallerStatus(item: InventoryItem) {
    if (savingToolStatusIds.current.has(item.id) || isTallerStatusBusy(tallerStatusState, item.id)) return;
    const toolId = toolDocumentId(item);
    if (!toolId) {
      setError('No se pudo identificar la herramienta que se desea actualizar.');
      return;
    }
    const current = statusValueForItem(item);
    const isMaintenance = normalize(current).includes('mant');
    const nextStatus = isMaintenance ? 'Bueno' : 'Mantenimiento';
    savingToolStatusIds.current.add(item.id);
    setTallerStatusState((state) => beginTallerStatusUpdate(state, item.id, nextStatus));

    try {
      await updateDoc(doc(db, 'herramientas', toolId), { estado: nextStatus });
      setTallerStatusState((state) => markTallerStatusWriteAccepted(state, item.id));
    } catch (updateError) {
      console.error('No se pudo actualizar el estado del ítem de Taller:', updateError);
      const message = 'No se pudo guardar el estado. Se restauró el valor confirmado por Firestore.';
      setTallerStatusState((state) => rollbackTallerStatusUpdate(state, item.id, message));
      setError(message);
    } finally {
      savingToolStatusIds.current.delete(item.id);
    }
  }

  function updateValuationDraft(item: InventoryItem, value: string) {
    setValuationEditBaselines((current) => captureValuationBaseline(
      current,
      item.valuationId,
      valuationRevisions[item.valuationId] ?? emptyValuationRevision(),
    ));
    setValuationDrafts((prev) => ({ ...prev, [item.valuationId]: value }));
    setValuationSaveStates((prev) => {
      if (prev[item.valuationId] === 'conflict') return prev;
      const next = { ...prev };
      delete next[item.valuationId];
      return next;
    });
  }

  function resetValuationDraft(item: InventoryItem) {
    setValuationDrafts((prev) => {
      const next = { ...prev };
      delete next[item.valuationId];
      return next;
    });
    setValuationEditBaselines((prev) => removeValuationBaseline(prev, item.valuationId));
    setValuationConflicts((prev) => {
      const next = { ...prev };
      delete next[item.valuationId];
      return next;
    });
  }

  function beginValuationEdit(item: InventoryItem) {
    setValuationEditBaselines((current) => captureValuationBaseline(
      current,
      item.valuationId,
      valuationRevisions[item.valuationId] ?? emptyValuationRevision(),
    ));
  }

  function valuationInventorySource(item: InventoryItem): FirestoreSourceKey {
    if (item.id.startsWith('aseo-')) return 'aseo';
    if (item.id.startsWith('herramienta-') || item.modulo === 'TALLER') return 'tools';
    return 'inventory';
  }

  function manualValuationSourcesReady(item: InventoryItem) {
    return isServerSourceReady(firestoreSources.valuations)
      && isServerSourceReady(firestoreSources[valuationInventorySource(item)]);
  }

  function manualValuationBlockedReason(item: InventoryItem) {
    if (!online) return 'Conéctate a Firestore para guardar cambios.';
    if (usingTallerFallback) return 'No se puede valorar Taller usando datos de respaldo.';
    const sources = [
      firestoreSources.valuations,
      firestoreSources[valuationInventorySource(item)],
    ];
    if (sources.some((source) => source.error)) return 'No se pudieron confirmar los datos con el servidor.';
    if (sources.some((source) => !source.received)) return 'Espera a que carguen los datos desde el servidor.';
    if (sources.some((source) => source.fromCache)) return 'No se puede guardar mientras los datos provengan de caché.';
    if (sources.some((source) => source.hasPendingWrites)) return 'Espera a que terminen las escrituras pendientes.';
    return '';
  }

  async function saveUnitValuation(item: InventoryItem): Promise<boolean> {
    if (savingValuationIds.current.has(item.valuationId)) return false;
    const rawValue = valuationDrafts[item.valuationId];
    if (rawValue === undefined) {
      setValuationEditBaselines((current) => removeValuationBaseline(current, item.valuationId));
      return false;
    }
    if (valuationConflicts[item.valuationId]) {
      setError('Recarga el valor actual del servidor antes de intentar guardar de nuevo.');
      return false;
    }

    savingValuationIds.current.add(item.valuationId);
    setValuationSaveStates((prev) => ({ ...prev, [item.valuationId]: 'saving' }));
    try {
      const result = await saveManualUnitValuation({
        db,
        valuationId: item.valuationId,
        expectedRevision: valuationEditBaselines[item.valuationId]
          ?? valuationRevisions[item.valuationId]
          ?? emptyValuationRevision(),
        rawValue,
        moduleName: item.modulo,
        code: item.codigo,
        description: item.descripcion,
        userLabel: user.email || user.uid,
        userUid: user.uid,
        online,
        sourceReady: manualValuationSourcesReady(item) && !usingTallerFallback,
      });
      setValuations((prev) => ({ ...prev, [item.valuationId]: result.unitValue }));
      resetValuationDraft(item);
      setValuationSaveStates((prev) => ({ ...prev, [item.valuationId]: 'saved' }));
      setError('');
      return true;
    } catch (caught) {
      if (caught instanceof ManualValuationConflictError) {
        const conflict = { current: caught.current };
        setValuationConflicts((prev) => ({ ...prev, [item.valuationId]: conflict }));
        setValuationSaveStates((prev) => ({ ...prev, [item.valuationId]: 'conflict' }));
        setValuationEditItem(item);
        setError(`Conflicto en ${item.descripcion}: el servidor tiene ${formatCurrency(caught.current.unitValue)}. No se escribió el cambio.`);
        return false;
      }
      console.error('No pude guardar la valoración unitaria:', caught);
      setValuationSaveStates((prev) => ({ ...prev, [item.valuationId]: 'error' }));
      setError(caught instanceof ManualValuationBlockedError
        ? caught.message
        : 'No se pudo guardar el valor unitario. Verifica la conexión y los permisos de Firebase.');
      return false;
    } finally {
      savingValuationIds.current.delete(item.valuationId);
    }
  }

  function openValuationModal(item: InventoryItem) {
    setValuationEditBaselines((current) => ({
      ...current,
      [item.valuationId]: valuationRevisions[item.valuationId] ?? emptyValuationRevision(),
    }));
    setValuationConflicts((current) => {
      const next = { ...current };
      delete next[item.valuationId];
      return next;
    });
    updateValuationDraft(item, String(valuations[item.valuationId] ?? 0));
    setValuationEditItem(item);
  }

  function reloadValuationConflict(item: InventoryItem) {
    const conflict = valuationConflicts[item.valuationId];
    if (!conflict) return;
    setValuations((current) => ({ ...current, [item.valuationId]: conflict.current.unitValue }));
    setValuationEditBaselines((current) => ({ ...current, [item.valuationId]: conflict.current }));
    setValuationDrafts((current) => ({ ...current, [item.valuationId]: String(conflict.current.unitValue) }));
    setValuationConflicts((current) => {
      const next = { ...current };
      delete next[item.valuationId];
      return next;
    });
    setValuationSaveStates((current) => {
      const next = { ...current };
      delete next[item.valuationId];
      return next;
    });
    setError('');
  }

  function closeValuationModal() {
    if (!valuationEditItem || valuationSaveStates[valuationEditItem.valuationId] === 'saving') return;
    resetValuationDraft(valuationEditItem);
    setValuationEditItem(null);
  }

  async function saveValuationModal() {
    if (!valuationEditItem) return;
    const saved = await saveUnitValuation(valuationEditItem);
    if (saved) setValuationEditItem(null);
  }

  function renderValuationCells(item: InventoryItem) {
    const unitValue = valuations[item.valuationId] ?? 0;
    const inputValue = valuationDrafts[item.valuationId] ?? (unitValue > 0 ? String(unitValue) : '');
    const saveState = valuationSaveStates[item.valuationId];
    const saveLabel = saveState === 'saving'
      ? 'Guardando...'
      : saveState === 'saved'
        ? 'Guardado'
        : saveState === 'error'
          ? 'Revisa el valor'
          : saveState === 'conflict'
            ? 'Conflicto: recarga'
          : '';
    const blockedReason = manualValuationBlockedReason(item);
    const disabled = Boolean(blockedReason);

    return (
      <>
        <td className="valuation-unit-cell" data-filter-value={formatCurrency(unitValue)}>
          <label className={`valuation-input ${saveState ?? ''}`} title={blockedReason || 'Se guarda al salir del campo o presionar Enter.'}>
            <span>$</span>
            <input
              aria-label={`Valor unitario de ${item.descripcion}`}
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              placeholder="0"
              value={inputValue}
              disabled={disabled || saveState === 'saving'}
              onFocus={() => beginValuationEdit(item)}
              onChange={(event) => updateValuationDraft(item, event.target.value)}
              onBlur={() => saveUnitValuation(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  resetValuationDraft(item);
                }
              }}
            />
          </label>
          {saveLabel && <small className={`valuation-save-state ${saveState}`}>{saveLabel}</small>}
        </td>
        <td className="numeric valuation-total">{formatCurrency(unitValue * valuationQuantity(item))}</td>
      </>
    );
  }

  const isValuationModule = module === inventoryValuationModule;
  const isAnalysisModule = module === inventoryIndicatorsModule;
  const isOperationalModule = !isValuationModule && !isAnalysisModule;
  const isTallerModule = module === 'TALLER';
  const isAgroquimicosModule = module === 'Agroquimicos';
  const isLubricantesTallerModule = moduleMatches(module, 'Lubricantes taller');
  const agroquimicosInventoryBase = useMemo(
    () => inventory.filter((item) => moduleMatches(item.modulo, 'Agroquimicos')),
    [inventory],
  );
  const agrochemicalExpirationProducts = useMemo(() => agroquimicosInventoryBase
    .map((item) => ({
      id: item.id,
      code: item.codigo,
      name: item.descripcion,
      stock: item.saldo,
      unit: item.unidad,
      location: item.ubicacion || '',
    }))
    .sort((left, right) => left.code.localeCompare(right.code) || left.name.localeCompare(right.name)), [agroquimicosInventoryBase]);
  const agrochemicalStockEntries = useMemo(() => entryStockMovements.map((entry) => ({
    id: entry.id,
    productDocumentId: entry.productId,
    moduleName: entry.moduleName,
    code: entry.code,
    productName: entry.product,
    quantity: entry.quantity,
    unit: entry.unit,
    dateLabel: entry.dateLabel,
    dateKey: entry.createdAt?.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) || '',
    createdAtMs: entry.createdAtMs,
    validationIssue: entry.validationIssue,
  })), [entryStockMovements]);
  const pendingAgrochemicalEntryCount = useMemo(() => buildAgrochemicalEntryQueue(
    agrochemicalStockEntries,
    agrochemicalLots,
  ).filter((entry) => entry.assignmentStatus !== 'assigned').length, [agrochemicalLots, agrochemicalStockEntries]);

  async function registerAgrochemicalLot(registration: AgrochemicalLotRegistration) {
    if (agrochemicalLotsLoading || agrochemicalLotsError) {
      throw new Error('No se puede registrar hasta confirmar la lectura completa de los lotes existentes.');
    }
    const product = agroquimicosInventoryBase.find((item) => item.id === registration.productDocumentId);
    if (!product) throw new Error('El producto ya no está disponible en el inventario actual.');
    const lotId = agrochemicalLotDocumentId(registration.lotNumber, registration.expirationDate);
    if (!lotId) throw new Error('El número de lote o la fecha de vencimiento no son válidos.');
    const assignedQuantity = agrochemicalLots
      .filter((lot) => lot.productDocumentId === product.id)
      .reduce((sum, lot) => sum + Math.max(0, lot.quantity), 0);
    const sourceEntry = registration.sourceEntryId
      ? entryStockMovements.find((entry) => entry.id === registration.sourceEntryId)
      : undefined;
    if (registration.sourceEntryId && !sourceEntry) throw new Error('La entrada móvil ya no está disponible.');
    if (!sourceEntry && assignedQuantity + registration.quantity > product.saldo + 1e-7) {
      throw new Error('La cantidad del lote supera el saldo del producto que todavía no tiene lote asignado.');
    }
    if (registration.linkExistingLotWithoutStockIncrease && !sourceEntry) {
      throw new Error('Solo una entrada móvil pendiente puede vincularse a un lote existente sin aumentar saldo.');
    }
    if (sourceEntry) {
      if (sourceEntry.validationIssue) throw new Error(sourceEntry.validationIssue);
      if (sourceEntry.productId !== product.id || !moduleMatches(sourceEntry.moduleName, 'Agroquimicos')) {
        throw new Error('La entrada móvil no corresponde al producto Agroquímico seleccionado.');
      }
    }

    const productRef = doc(db, 'existencias', product.id);
    const lotRef = doc(productRef, 'lotes_agroquimicos', lotId);
    const movementRef = sourceEntry ? doc(db, 'movimientos', sourceEntry.id) : null;
    const assignmentRef = sourceEntry
      ? doc(productRef, 'asignaciones_entradas_agroquimicos', sourceEntry.id)
      : null;
    await runTransaction(db, async (transaction) => {
      const [currentProduct, currentLot, currentMovement, currentAssignment] = await Promise.all([
        transaction.get(productRef),
        transaction.get(lotRef),
        movementRef ? transaction.get(movementRef) : Promise.resolve(null),
        assignmentRef ? transaction.get(assignmentRef) : Promise.resolve(null),
      ]);
      if (!currentProduct.exists() || !moduleMatches(textValue(currentProduct.data(), 'modulo'), 'Agroquimicos')) {
        throw new Error('El producto cambió y ya no pertenece a Agroquímicos.');
      }
      const liveStock = numberValue(currentProduct.data(), 'cantidad', 'stock_actual', 'stock', 'saldo');
      if (!sourceEntry && assignedQuantity + registration.quantity > liveStock + 1e-7) {
        throw new Error('El saldo del producto cambió y ya no permite asignar esa cantidad.');
      }

      if (currentLot.exists()) {
        const existingLotNumber = textValue(currentLot.data(), 'numero_lote', 'lote', 'numeroLote');
        const existingExpiration = dateTextValue(currentLot.data(), 'fecha_vencimiento', 'fechaVencimiento', 'vencimiento');
        if (
          normalize(existingLotNumber) !== normalize(registration.lotNumber)
          || existingExpiration !== registration.expirationDate
        ) throw new Error('El identificador del lote coincide con un registro de datos diferentes.');
      } else if (registration.linkExistingLotWithoutStockIncrease) {
        throw new Error('El lote seleccionado ya no existe; no se puede vincular una entrada sin aumentar saldo.');
      }

      let entryAssignments = currentLot.exists()
        ? agrochemicalLotEntryAssignments(currentLot.data())
        : [];
      let assignedToEntry = 0;
      if (sourceEntry && currentMovement && assignmentRef) {
        if (!currentMovement.exists()) throw new Error('La entrada móvil ya no existe.');
        const movementData = currentMovement.data();
        const movementProductId = textValue(movementData, 'producto_id', 'documento_id');
        const movementQuantity = numberValue(movementData, 'cantidad', 'cantidad_entrada', 'cantidadNumerica');
        if (
          textValue(movementData, 'clase_movimiento') !== 'entrada_stock'
          || movementProductId !== product.id
          || !moduleMatches(textValue(movementData, 'modulo'), 'Agroquimicos')
          || movementQuantity <= 0
        ) throw new Error('La entrada cambió o ya no es una entrada válida de Agroquímicos.');
        assignedToEntry = currentAssignment?.exists()
          ? numberValue(currentAssignment.data(), 'cantidad_asignada')
          : agrochemicalLots.flatMap((lot) => lot.entryAssignments)
            .filter((assignment) => assignment.entryId === sourceEntry.id)
            .reduce((sum, assignment) => sum + assignment.quantity, 0);
        if (assignedToEntry + registration.quantity > movementQuantity + 1e-7) {
          throw new Error('La cantidad supera lo que queda pendiente de esa entrada móvil.');
        }
        const previousForEntry = entryAssignments.find((entry) => entry.entryId === sourceEntry.id)?.quantity ?? 0;
        entryAssignments = [
          ...entryAssignments.filter((entry) => entry.entryId !== sourceEntry.id),
          { entryId: sourceEntry.id, quantity: previousForEntry + registration.quantity },
        ];
        transaction.set(assignmentRef, {
          entrada_id: sourceEntry.id,
          producto_id: product.id,
          cantidad_entrada: movementQuantity,
          cantidad_asignada: assignedToEntry + registration.quantity,
          asignacion_completa: Math.abs((assignedToEntry + registration.quantity) - movementQuantity) < 1e-7,
          actualizado_en: serverTimestamp(),
        }, { merge: true });
      }

      const previousLotQuantity = currentLot.exists()
        ? numberValue(currentLot.data(), 'cantidad_disponible', 'cantidad', 'saldo')
        : 0;
      const previousInitialQuantity = currentLot.exists()
        ? numberValue(currentLot.data(), 'cantidad_inicial', 'cantidad_entrada', 'cantidad')
        : 0;
      const previousReceivedAt = currentLot.exists()
        ? dateTextValue(currentLot.data(), 'fecha_ingreso', 'fecha_entrada', 'createdAt', 'creado_en')
        : '';
      const quantityToAddToLot = registration.linkExistingLotWithoutStockIncrease ? 0 : registration.quantity;
      transaction.set(lotRef, {
        producto_id: product.id,
        codigo_producto: product.codigo,
        producto: product.descripcion,
        numero_lote: registration.lotNumber,
        fecha_vencimiento: registration.expirationDate,
        fecha_ingreso: previousReceivedAt || registration.receivedAt,
        cantidad_inicial: previousInitialQuantity + quantityToAddToLot,
        cantidad_disponible: previousLotQuantity + quantityToAddToLot,
        asignaciones_entrada: entryAssignments.map((entry) => ({
          entrada_id: entry.entryId,
          cantidad: entry.quantity,
        })),
        unidad: product.unidad,
        ubicacion: product.ubicacion || '',
        ...(!currentLot.exists() ? { creado_en: serverTimestamp() } : {}),
        actualizado_en: serverTimestamp(),
      });
    });
  }
  const toolsInventory = useMemo(
    () => visibleToolInventory(tools, usingCachedData && tools.length === 0 && !online),
    [online, tools, usingCachedData],
  );
  const valuationInventory = useMemo(() => {
    const operationalInventory = inventory.filter((item) => (
      !moduleMatches(item.modulo, 'ASEO') && !moduleMatches(item.modulo, 'TALLER')
      && isInventoryValuationModuleIncluded(item.modulo)
    ));
    return [...operationalInventory, ...aseoInventory]
      .filter((item) => isInventoryValuationModuleIncluded(valuationModuleForItem(item)))
      .sort((a, b) => (
        valuationModuleForItem(a).localeCompare(valuationModuleForItem(b))
        || compareCodes(a.codigo, b.codigo)
        || a.descripcion.localeCompare(b.descripcion)
      ));
  }, [aseoInventory, inventory]);
  const valuationModuleOptions = useMemo(() => {
    const baseModules = operationalModules.filter(isInventoryValuationModuleIncluded);
    const knownModules = new Set<string>(baseModules);
    const additionalModules = valuationInventory
      .map(valuationModuleForItem)
      .filter(isInventoryValuationModuleIncluded)
      .filter((moduleName) => !knownModules.has(moduleName));
    return [...baseModules, ...Array.from(new Set(additionalModules)).sort((a, b) => a.localeCompare(b))];
  }, [valuationInventory]);
  const valuationRows = useMemo<CurrentValuationRow[]>(() => valuationInventory.map((item) => {
    const moduleName = valuationModuleForItem(item);
    const quantity = valuationQuantity(item);
    const unitValue = valuations[item.valuationId] ?? 0;
    return {
      valuationId: item.valuationId,
      moduleName,
      code: item.codigoQr || item.codigo,
      product: item.descripcion,
      reference: item.referencia.trim() || 'N/A',
      quantity,
      unit: item.unidad,
      unitValue,
      totalValue: unitValue * quantity,
      includesOccupied: moduleName === 'TALLER',
    };
  }), [valuationInventory, valuations]);
  const agrochemicalExpirationByProduct = useMemo(
    () => earliestAvailableLotExpirationByProduct(agrochemicalLots),
    [agrochemicalLots],
  );
  const analysisSourceProducts = useMemo(() => [...inventory, ...aseoInventory, ...tools]
    .filter((item) => !item.id.startsWith('fallback-'))
    .filter((item) => !moduleMatches(item.modulo, 'TALLER'))
    .map((item) => ({
      id: item.id,
      module: item.modulo,
      code: item.codigoQr || item.codigo,
      name: item.descripcion,
      reference: item.referencia,
      category: item.categoria,
      unit: item.unidad,
      location: item.ubicacion,
      currentStock: item.saldo,
      expirationDate: agrochemicalExpirationByProduct.get(item.id) ?? item.expirationDate,
      confirmedObsolete: item.confirmedObsolete,
    })), [agrochemicalExpirationByProduct, aseoInventory, inventory, tools]);
  const analysisSourceMovements = useMemo(() => movements
    .filter((movement) => !moduleMatches(movement.modulo, 'TALLER'))
    .map((movement) => ({
      id: movement.id,
      module: movement.modulo,
      type: movement.tipo,
      code: movement.codigo,
      name: movement.descripcion,
      reference: movement.referencia,
      quantity: movement.cantidad,
      occurredAt: movement.fecha,
      productDocumentId: movement.productDocumentId,
      stockBefore: movement.stockBefore,
      stockAfter: movement.stockAfter,
    })), [movements]);
  const estimatedExitExpense = useMemo(() => calculateEstimatedExitExpense(
    valuationRows,
    analysisSourceProducts,
    analysisSourceMovements,
  ), [analysisSourceMovements, analysisSourceProducts, valuationRows]);
  const monthlyActivitySources = useMemo<MonthlyActivitySource[]>(() => movements.map((movement) => ({
    id: movement.id, module: movement.modulo, type: movement.tipo,
    code: movement.codigo, name: movement.descripcion, reference: movement.referencia,
    quantity: movement.cantidad, unit: movement.unidad,
    occurredAt: movement.monthlyOccurredAt || movement.fecha,
    productDocumentId: movement.productDocumentId,
    destinationLot: movement.destinationLot, observations: movement.observaciones, zone: movement.zona,
    labor: movement.labor, front: movement.frente,
    position: [movement.cargo, users[movement.solicitante]?.cargo].filter(Boolean).join(' '),
    machinery: movement.maquinaria,
    recipientId: users[movement.solicitante] ? `uid:${movement.solicitante}` : movement.solicitante,
    recipientName: users[movement.solicitante]?.nombre || users[movement.solicitante]?.email || movement.solicitante,
  })), [movements, users]);

  useEffect(() => {
    if (
      !isAnalysisModule
      || analysisHistoryLoadAttemptedRef.current
      || !hasMoreMovements
      || loadingMoreMovements
      || !online
      || !isServerSourceReady(firestoreSources.movements)
    ) return;
    analysisHistoryLoadAttemptedRef.current = true;
    void loadCompleteMovementHistory().catch(() => undefined);
  }, [firestoreSources.movements, hasMoreMovements, isAnalysisModule, loadingMoreMovements, online]);
  useEffect(() => {
    if (
      !isValuationModule
      || valuationHistoryLoadAttemptedRef.current
      || !hasMoreMovements
      || loadingMoreMovements
      || !online
      || !isServerSourceReady(firestoreSources.movements)
    ) return;
    valuationHistoryLoadAttemptedRef.current = true;
    void loadCompleteMovementHistory().catch(() => undefined);
  }, [firestoreSources.movements, hasMoreMovements, isValuationModule, loadingMoreMovements, online]);
  const usingTallerFallback = isTallerModule && tools.length === 0 && toolsInventory.length > 0;
  const moduleInventoryBase = useMemo(() => {
    const operationalInventory = inventory.filter((item) => !moduleMatches(item.modulo, 'ASEO'));
    const visibleTools = isTallerModule ? toolsInventory : [];
    const stockItems = isTallerModule
      ? visibleTools
      : [...operationalInventory, ...aseoInventory, ...visibleTools];
    const reconciledInventory = reconcileInventoryWithMovements(stockItems, movements);
    return reconciledInventory
      .filter((item) => moduleMatches(item.modulo, module))
      .filter((item) => !(isTallerModule && retiredToolCodes.has(normalizeToolCode(item.codigo))))
      .filter((item) => !isTallerModule || coincideSubmoduloTaller(item.categoria, tallerSubmodulo))
      .filter((item) => !isAgroquimicosModule || coincideUbicacionAgroquimicos(item.ubicacion ?? '', agroquimicosUbicacion));
  }, [agroquimicosUbicacion, aseoInventory, inventory, isAgroquimicosModule, isTallerModule, module, tallerSubmodulo, toolsInventory]);

  const moduleInventory = useMemo(() => {
    const filtered = filterAndSortInventoryView(moduleInventoryBase, search);
    if (isTallerModule) {
      return sortTallerInventory(filtered, statusOrder, statusValueForItem);
    }
    return filtered;
  }, [isTallerModule, moduleInventoryBase, search, statusOrder, tallerStatusState]);

  const belongsToMovementScope = useCallback((movement: Movement) => (
    moduleMatches(movement.modulo, module)
    && (!isTallerModule || movimientoPerteneceSubmoduloTaller(movement, tallerSubmodulo))
    && (!isAgroquimicosModule || movimientoPerteneceUbicacionAgroquimicos(movement, agroquimicosUbicacion))
  ), [agroquimicosUbicacion, isAgroquimicosModule, isTallerModule, module, tallerSubmodulo]);

  const tallerStatusByMovementKey = useMemo(() => {
    const entries: Array<[string, string]> = [];
    moduleInventoryBase.forEach((item) => {
      inventoryLookupKeys(item).forEach((key) => entries.push([key, statusValueForItem(item)]));
    });
    return new Map(entries);
  }, [moduleInventoryBase, tallerStatusState]);

  const movementStatusRank = useCallback((movement: Movement) => {
    if (!isTallerModule || statusOrder === 'default') return 0;
    const status = movementLookupKeys(movement)
      .map((key) => tallerStatusByMovementKey.get(key))
      .find(Boolean) ?? '';
    return tallerStatusRank(status, statusOrder);
  }, [isTallerModule, statusOrder, tallerStatusByMovementKey]);

  const scopedMovements = useMemo(() => filterAndSortMovementView(movements, {
    search: '',
    dateFrom: '',
    dateTo: '',
    code: '',
    person: '',
    product: '',
    belongsToScope: belongsToMovementScope,
    personText: (movement) => movementPersonText(movement, users),
  }), [belongsToMovementScope, movements, users]);

  useEffect(() => {
    const scopeKey = [
      module,
      isTallerModule ? tallerSubmodulo : '',
      isAgroquimicosModule ? agroquimicosUbicacion : '',
    ].join('|');
    const alreadyAttempted = autoLoadedEmptyMovementScopesRef.current.has(scopeKey);
    const shouldAutoLoad = shouldAutoLoadCompleteMovementHistory({
      activeScopeHasMovements: scopedMovements.length > 0,
      alreadyAttempted,
      hasMoreMovements,
      isLoading: loadingMoreMovements,
      isOnline: online,
      isServerReady: isServerSourceReady(firestoreSources.movements),
      isValuationModule,
    });
    if (!shouldAutoLoad) return;

    autoLoadedEmptyMovementScopesRef.current.add(scopeKey);
    void loadCompleteMovementHistory().catch(() => undefined);
  }, [
    agroquimicosUbicacion,
    firestoreSources.movements,
    hasMoreMovements,
    isAgroquimicosModule,
    isTallerModule,
    isValuationModule,
    loadingMoreMovements,
    module,
    online,
    scopedMovements.length,
    tallerSubmodulo,
  ]);

  const buildVisibleMovementSource = useCallback((source: readonly Movement[]) => filterAndSortMovementView(source, {
    search,
    dateFrom: exitDateFrom,
    dateTo: exitDateTo,
    code: exitCode,
    person: exitPerson,
    product: exitItem,
    belongsToScope: belongsToMovementScope,
    personText: (movement) => movementPersonText(movement, users),
    statusRank: isTallerModule && statusOrder !== 'default' ? movementStatusRank : undefined,
  }), [belongsToMovementScope, exitCode, exitDateFrom, exitDateTo, exitItem, exitPerson, isTallerModule, movementStatusRank, search, statusOrder, users]);

  const visibleMovements = useMemo(
    () => buildVisibleMovementSource(movements),
    [buildVisibleMovementSource, movements],
  );

  const occupiedUnitCards = useMemo(() => {
    if (!isTallerModule) return [];
    const occupiedTools = toolsInventory
      .filter((item) => !retiredToolCodes.has(normalizeToolCode(item.codigo)))
      .filter((item) => !tallerSubmodulo || coincideSubmoduloTaller(item.categoria, tallerSubmodulo))
      .filter((item) => (item.ocupados ?? 0) > 0);
    return expandTallerOccupiedUnits(occupiedTools, scopedMovements);
  }, [isTallerModule, scopedMovements, toolsInventory, tallerSubmodulo]);

  const occupiedGroups = useMemo(
    () => groupOccupiedBySubmodule(occupiedUnitCards),
    [occupiedUnitCards],
  );
  const totals = useMemo(
    () => buildTotals(scopedMovements, isTallerModule ? tallerSubmodulo : ''),
    [isTallerModule, scopedMovements, tallerSubmodulo],
  );
  const combustibleFuelStock = useMemo(
    () => (module === 'Combustible' ? combustibleStockByType(moduleInventoryBase) : null),
    [module, moduleInventoryBase],
  );
  const movementLimit = isTallerModule ? 100 : 24;
  const tallerMovementLabels = useMemo(
    () => (isTallerModule ? etiquetasMovimientoTaller(tallerSubmodulo) : null),
    [isTallerModule, tallerSubmodulo],
  );
  const isBodegaRojaView = isTallerModule && esBodegaRojaTaller(tallerSubmodulo);
  const allEntries = useMemo(
    () => visibleMovements.filter((movement) => movementIsEntry(movement, isTallerModule ? tallerSubmodulo : '')),
    [isTallerModule, visibleMovements, tallerSubmodulo],
  );
  const entryModalLimit = isTallerModule ? 200 : 120;
  const filteredExits = useMemo(
    () => visibleMovements.filter((movement) => movementIsExit(movement, isTallerModule ? tallerSubmodulo : '')),
    [visibleMovements, isTallerModule, tallerSubmodulo],
  );
  const hasExitFilters = Boolean(
    search.trim()
    || exitDateFrom
    || exitDateTo
    || exitCode.trim()
    || exitPerson.trim()
    || exitItem.trim(),
  );
  const loadedHistoryCoversDateRange = Boolean(
    exitDateFrom && loadedMovementHistoryCoversDate(movements, exitDateFrom),
  );
  const canLoadOlderFilteredHistory = hasMoreMovements
    && (!hasExitFilters || !exitDateFrom || !loadedHistoryCoversDateRange);

  useEffect(() => {
    setExitVisibleLimit(movementLimit);
  }, [agroquimicosUbicacion, hasExitFilters, module, movementLimit, tallerSubmodulo]);

  useEffect(() => {
    if (
      !hasExitFilters
      || !exitDateFrom
      || loadedHistoryCoversDateRange
      || !hasMoreMovements
      || loadingMoreMovements
      || !online
      || !isServerSourceReady(firestoreSources.movements)
    ) return;

    void loadMoreMovementHistory();
  }, [
    exitDateFrom,
    firestoreSources.movements,
    hasExitFilters,
    hasMoreMovements,
    loadedHistoryCoversDateRange,
    loadingMoreMovements,
    online,
  ]);

  async function loadCurrentReportInventory() {
    let sourceItems: InventoryItem[];
    if (isTallerModule) {
      const snapshot = await getDocsFromServer(collection(db, 'herramientas'));
      sourceItems = snapshot.docs.map(readToolDoc);
    } else if (moduleMatches(module, 'ASEO')) {
      const snapshot = await getDocsFromServer(collection(db, 'productos_aseo'));
      sourceItems = snapshot.docs.map(readAseoDoc);
    } else {
      const snapshot = await getDocsFromServer(collection(db, 'existencias'));
      sourceItems = snapshot.docs
        .map(readInventoryDoc)
        .filter((item) => !isHistoricalInventoryModule(item.modulo));
    }

    return sourceItems
      .filter((item) => moduleMatches(item.modulo, module))
      .filter((item) => !(isTallerModule && retiredToolCodes.has(normalizeToolCode(item.codigo))))
      .filter((item) => !isTallerModule || coincideSubmoduloTaller(item.categoria, tallerSubmodulo))
      .filter((item) => !isAgroquimicosModule
        || coincideUbicacionAgroquimicos(item.ubicacion ?? '', agroquimicosUbicacion));
  }

  async function exportarReporte() {
    if (!online || !isServerSourceReady(firestoreSources.movements)) {
      setError('El reporte requiere conexión y la primera página de movimientos confirmada por el servidor.');
      return;
    }

    setExportando(true);
    setError('');
    try {
      let inventoryBefore = await loadCurrentReportInventory();
      let completeHistory = await loadCompleteMovementHistory();
      let inventoryAfter = await loadCurrentReportInventory();

      if (inventoryReportFingerprint(inventoryBefore) !== inventoryReportFingerprint(inventoryAfter)) {
        inventoryBefore = inventoryAfter;
        completeHistory = await loadCompleteMovementHistory();
        inventoryAfter = await loadCurrentReportInventory();
        if (inventoryReportFingerprint(inventoryBefore) !== inventoryReportFingerprint(inventoryAfter)) {
          setError('El inventario cambió mientras se preparaba el reporte. Intenta exportar nuevamente cuando no haya movimientos en curso.');
          return;
        }
      }

      const reportMovements = buildVisibleMovementSource(completeHistory);
      const reconciliationHistory = completeHistory.filter(belongsToMovementScope);
      if (reportMovements.length === 0 && inventoryAfter.length === 0) {
        setError('No hay inventario ni movimientos que coincidan con el módulo y los filtros activos.');
        return;
      }
      const reportLots = isAgroquimicosModule
        ? (await getDocsFromServer(collectionGroup(db, 'lotes_agroquimicos'))).docs.map(readAgrochemicalLotDoc)
        : [];
      const payload = crearReporteMovimientos({
        moduleName: module,
        tallerSubmodulo: isTallerModule ? tallerSubmodulo : '',
        movimientos: reportMovements,
        historialCompleto: reconciliationHistory,
        inventarioActual: inventoryAfter.map(inventoryItemForReport),
        lotesAgroquimicos: reportLots,
        usuarios: users,
        periodLabel: etiquetaPeriodoReporte(exitDateFrom, exitDateTo),
        exportDate: fechaExportacionReporte(),
        generatedBy: user.email || user.displayName || 'Usuario',
        coverageLabel: 'Inventario real confirmado por servidor; historial completo cargado; filtros activos aplicados',
      });
      const result = await exportMovementReportWeb(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.canceled) return;
    } catch {
      setError((current) => current || 'No se pudo generar el reporte Excel desde el navegador.');
    } finally {
      setExportando(false);
    }
  }

  const exitDisplayCount = movementDisplayCount(
    filteredExits.length,
    exitVisibleLimit,
    hasExitFilters,
  );
  const exits = filteredExits.slice(0, exitDisplayCount);
  const canShowMoreExits = exits.length < filteredExits.length || canLoadOlderFilteredHistory;

  async function showMoreExitMovements() {
    if (exits.length < filteredExits.length) {
      setExitVisibleLimit((current) => nextMovementDisplayLimit(current, movementLimit));
      return;
    }
    if (!canLoadOlderFilteredHistory) return;
    await loadMoreMovementHistory();
    if (!hasExitFilters) {
      setExitVisibleLimit((current) => nextMovementDisplayLimit(current, movementLimit));
    }
  }
  const inventoryColumnCount = isTallerModule ? 10 : module === 'Agroquimicos' ? 11 : isLubricantesTallerModule ? 9 : 10;
  const totalSaldo = isTallerModule
    ? moduleInventory.reduce((sum, item) => sum + item.saldo, 0)
    : moduleInventory.reduce((sum, item) => sum + item.saldo, 0);
  const totalOcupados = isTallerModule
    ? moduleInventory.reduce((sum, item) => sum + (item.ocupados ?? 0), 0)
    : 0;
  const lowStock = isTallerModule
    ? moduleInventory.filter((item) => item.requiereQr || (item.ocupados ?? 0) > 0 || normalize(item.estado ?? '').includes('uso')).length
    : moduleInventory.filter((item) => item.saldo <= 3).length;
  const totalValuation = moduleInventory.reduce(
    (sum, item) => sum + (valuations[item.valuationId] ?? 0) * valuationQuantity(item),
    0,
  );
  const syncMode = !online
    ? 'offline'
    : allSourcesReady
      ? 'online'
      : firestoreErrors.length > 0
        ? 'offline'
        : usingCachedData
          ? 'cached'
          : 'syncing';
  const syncLabel = !online
    ? 'Sin internet'
    : allSourcesReady
      ? 'En vivo'
      : firestoreErrors.length > 0
        ? 'Con errores'
        : usingCachedData
          ? 'Copia local'
          : 'Sincronizando';

  const activeAccent = moduleAccent(module);
  const moduleBlurb = moduleDescription(module);

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src={logoSrc} alt={brandName} />
          <div className="brand-copy">
            <strong>{brandName}</strong>
            <span>Gestión de almacén</span>
          </div>
        </div>

        <nav className="module-list" aria-label="Módulos">
          {modules.map((entry) => (
            <button
              key={entry}
              type="button"
              data-module={entry}
              className={entry === module ? 'active' : ''}
              style={{ '--module-accent': moduleAccent(entry) } as CSSProperties}
              onClick={() => selectModule(entry)}
              title={entry}
            >
              <span className="module-icon-wrap">
                <img src={moduleIcon(entry)} alt="" aria-hidden="true" />
              </span>
              <span className="module-label">{entry}</span>
            </button>
          ))}
        </nav>

        {canManageUsers && (
          <button
            className="pending-users-button"
            type="button"
            onClick={() => setShowPendingUsers(true)}
            aria-label={`Cuentas pendientes: ${pendingUsers.length}`}
            title="Gestionar cuentas de usuarios"
          >
            <Clock3 size={17} />
            <span>Gestionar cuentas</span>
            {pendingUsers.length > 0 && <strong>{pendingUsers.length}</strong>}
          </button>
        )}

        <div className="session-card">
          <UserRound size={18} />
          <div className="session-copy">
            <span>Sesión</span>
            <strong>{user.email}</strong>
          </div>
        </div>

        <button className="logout-button" onClick={() => signOut(auth)}>
          <LogOut size={17} />
          <span>Salir</span>
        </button>
      </aside>

      <section className="workspace" data-module={module} style={{ '--module-accent': activeAccent } as CSSProperties}>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>

        <section className="module-hero" aria-label={`Resumen del módulo ${module}`}>
          <div className="module-hero-icon">
            <img src={moduleIcon(module)} alt="" aria-hidden="true" />
          </div>
          <div className="module-hero-copy">
            <p className="eyebrow">{brandName} · Panel web</p>
            <h1>{module}</h1>
            <p className="module-hero-subtitle">{moduleBlurb}</p>
            <div className={`sync-status ${syncMode}`}>
              <span className="sync-dot" />
              <strong>{syncLabel}</strong>
              <span>Última sync: {formatSyncLabel(lastSync)}</span>
            </div>
          </div>
        </section>

        <header className="topbar">
          <div className="module-heading">
            <div>
              <p className="eyebrow">{isAnalysisModule ? 'Análisis histórico' : isValuationModule ? 'Resumen general' : 'Consulta operativa'}</p>
              <h2 className="topbar-title">{isAnalysisModule ? inventoryIndicatorsModule : isValuationModule ? inventoryValuationModule : 'Inventario y movimientos'}</h2>
            </div>
          </div>
          <div className={`toolbar ${isValuationModule ? 'valuation-toolbar' : ''}`}>
            {isOperationalModule && (
              <>
                <label className="search-box">
                  <Search size={18} />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código, descripción, unidad o categoría" />
                </label>
                {isTallerModule && (
                  <label className="status-sort">
                    <span>Ordenar:</span>
                    <select value={statusOrder} onChange={(event) => setStatusOrder(event.target.value as TallerStatusOrder)}>
                      <option value="default">Sin orden</option>
                      <option value="good-first">Buen estado primero</option>
                      <option value="maintenance-first">Mantenimiento primero</option>
                    </select>
                  </label>
                )}
                <button className="tool-button" type="button" onClick={() => setShowEntriesModal(true)}>
                  <ArrowDownLeft size={17} />
                  {tallerMovementLabels?.entradas ?? 'Entradas'} ({formatNumber(allEntries.length)}{hasMoreMovements ? '+' : ''})
                </button>
                {isTallerModule && (
                  <button className="tool-button" type="button" onClick={() => setShowOccupiedModal(true)}>
                    <AlertTriangle size={17} />
                    En uso ({formatNumber(occupiedUnitCards.length)})
                  </button>
                )}
                <button
                  className="tool-button"
                  type="button"
                  disabled={!canExportMovementReport
                    || exportando
                    || !online
                    || !isServerSourceReady(firestoreSources.movements)
                    || (!hasMoreMovements && visibleMovements.length === 0 && moduleInventoryBase.length === 0)}
                  onClick={() => { void exportarReporte(); }}
                  title={`Exportar movimientos del módulo ${module} (${nombreArchivoReporte(module)})`}
                >
                  <FileSpreadsheet size={17} />
                  {exportando ? 'Exportando...' : 'Exportar'}
                </button>
              </>
            )}
          </div>
        </header>

        {error && (
          <div className="alert-line">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}

        {firestoreErrors.map((message) => (
          <div className="alert-line" key={message}>
            <AlertTriangle size={18} />
            {message}
          </div>
        ))}

        {isOperationalModule && (hasMoreMovements || loadingMoreMovements || movementHistoryError) && (
          <div className={`history-pagination ${movementHistoryError ? 'error' : ''}`}>
            <div>
              <strong>
                {loadingMoreMovements && hasMoreMovements && scopedMovements.length === 0
                  ? `Buscando movimientos de ${module}`
                  : hasMoreMovements
                    ? 'Historial cargado parcialmente'
                    : 'Historial actualizado'}
              </strong>
              <span>
                {loadingMoreMovements && hasMoreMovements && scopedMovements.length === 0
                  ? `${formatNumber(movements.length)} movimientos revisados; buscando páginas anteriores automáticamente.`
                  : hasMoreMovements
                  ? `${formatNumber(movements.length)} movimientos cargados. Hay páginas anteriores disponibles; el Excel las carga antes de exportar.`
                  : `${formatNumber(movements.length)} movimientos cargados.`}
              </span>
              {movementHistoryError && <small>{movementHistoryError}</small>}
            </div>
            {hasMoreMovements && (
              <button type="button" disabled={loadingMoreMovements || !online || !isServerSourceReady(firestoreSources.movements)} onClick={() => { void loadMoreMovementHistory(); }}>
                {loadingMoreMovements ? 'Cargando...' : 'Cargar más'}
              </button>
            )}
          </div>
        )}

        {usingTallerFallback && (
          <div className="alert-line warning">
            <AlertTriangle size={18} />
            Sin conexión a Firestore: mostrando catálogo de respaldo de Herramientas Taller (49 ítems). Los demás submódulos no aparecen hasta reconectar.
          </div>
        )}

        {isTallerModule && tools.length === 0 && !usingTallerFallback && !loading && (
          <div className="alert-line warning">
            <AlertTriangle size={18} />
            No hay ítems en la colección herramientas de Firestore. Sincroniza el inventario desde la app Android o ejecuta el import JSON.
          </div>
        )}

        {isBodegaRojaView && tallerMovementLabels && (
          <div className="alert-line notice">
            <PackageCheck size={18} />
            {tallerMovementLabels.flujo}
          </div>
        )}

        {isValuationModule && (
          <InventoryValuationModule
            rows={valuationRows}
            moduleOptions={valuationModuleOptions}
            online={online}
            loading={valuationLoading}
            user={user}
            currentAverages={valuations}
            currentValuationIds={valuationDocumentIds}
            firestoreSources={firestoreSources}
            entryStockMovements={entryStockMovements}
            entryValuationRecords={entryValuationRecords}
            estimatedExitExpense={estimatedExitExpense}
            monthlyActivitySources={monthlyActivitySources}
            exitHistoryComplete={!hasMoreMovements && isServerSourceReady(firestoreSources.movements)}
            exitHistoryLoading={loadingMoreMovements}
            onEdit={(valuationId) => {
              const item = valuationInventory.find((entry) => entry.valuationId === valuationId);
              if (item) openValuationModal(item);
            }}
          />
        )}

        {isAnalysisModule && (
          <InventoryAnalysisPanel
            sourceProducts={analysisSourceProducts}
            sourceMovements={analysisSourceMovements}
            expirationLots={agrochemicalLots}
            agrochemicalEntries={agrochemicalStockEntries}
            historyComplete={!hasMoreMovements && isServerSourceReady(firestoreSources.movements)}
            loadingHistory={loadingMoreMovements}
            onLoadCompleteHistory={async () => {
              try {
                await loadCompleteMovementHistory();
              } catch {
                // El cargador ya publica un mensaje visible y conserva los datos existentes.
              }
            }}
          />
        )}

        {combustibleFuelStock && (
          <section className="fuel-kpi-grid" aria-label="Stock de combustible por tipo">
            {FUEL_TYPES.map((tipo) => (
              <article key={tipo} className={`fuel-kpi-card balance-${balanceTone(combustibleFuelStock[tipo])}`}>
                <span>{tipo}</span>
                <strong>{formatNumber(combustibleFuelStock[tipo])}</strong>
                <small>galones en bodega</small>
              </article>
            ))}
          </section>
        )}

        {isTallerModule && (
          <div className="submodule-filter-row">
            <SubmoduleButtons
              submodules={TALLER_SUBMODULOS}
              selected={tallerSubmodulo}
              onSelect={selectTallerSubmodulo}
              ariaLabel="Submódulos de Taller"
              counts={Object.fromEntries(TALLER_SUBMODULOS.map((s) => {
                const items = toolsInventory.filter((item) => coincideSubmoduloTaller(item.categoria, s) && !retiredToolCodes.has(normalizeToolCode(item.codigo)));
                const total = items.length;
                if (esBodegaRojaTaller(s)) return [s, total];
                const occupied = items.filter((item) => (item.ocupados ?? 0) > 0).length;
                return [s, `${occupied}/${total}`];
              }))}
              allCount={toolsInventory.filter((item) => !retiredToolCodes.has(normalizeToolCode(item.codigo))).length}
            />
          </div>
        )}

        {isAgroquimicosModule && (
          <div className="submodule-filter-row">
            <SubmoduleButtons
              submodules={AGROQUIMICOS_UBICACIONES}
              selected={agroquimicosUbicacion}
              onSelect={selectAgroquimicosUbicacion}
              formatLabel={etiquetaUbicacionAgroquimicos}
              ariaLabel="Ubicaciones de agroquímicos"
              counts={Object.fromEntries(AGROQUIMICOS_UBICACIONES.map((ubicacion) => [
                ubicacion,
                agroquimicosInventoryBase.filter((item) => coincideUbicacionAgroquimicos(item.ubicacion ?? '', ubicacion)).length,
              ]))}
              allCount={agroquimicosInventoryBase.length}
            />
            <button
              type="button"
              className="agro-expiration-button"
              onClick={() => setShowAgrochemicalExpirationModal(true)}
            >
              <CalendarClock size={17} />
              Fechas de vencimiento
              <span className="submodule-badge">{pendingAgrochemicalEntryCount}</span>
            </button>
          </div>
        )}

        {isOperationalModule && (
        <section className="kpi-grid">
          <article>
            <PackageCheck size={20} />
            <span>Referencias</span>
            <strong>{moduleInventory.length}</strong>
          </article>
          <article>
            <ShieldCheck size={20} />
            <span>{isTallerModule ? 'Disponibles' : 'Saldo total'}</span>
            <strong>{formatNumber(totalSaldo)}</strong>
          </article>
          {isTallerModule ? (
            <button type="button" className="kpi-card kpi-clickable" onClick={() => setShowOccupiedModal(true)} title="Ver ítems en uso">
              <AlertTriangle size={20} />
              <span>En uso / alertas</span>
              <strong>{formatNumber(occupiedUnitCards.length)} / {lowStock}</strong>
            </button>
          ) : (
            <article>
              <AlertTriangle size={20} />
              <span>Alertas</span>
              <strong>{lowStock}</strong>
            </article>
          )}
          <article>
            <FileSpreadsheet size={20} />
            <span>Movimientos</span>
            <strong>{visibleMovements.length}{hasMoreMovements ? '+' : ''}</strong>
          </article>
          <article className="valuation-kpi">
            <CircleDollarSign size={20} />
            <span>Valor inventario</span>
            <strong>{formatCurrency(totalValuation)}</strong>
          </article>
        </section>
        )}

        {isOperationalModule && (
        <section className="dashboard-grid" key={`dashboard-${module}-${tallerSubmodulo || agroquimicosUbicacion || 'todos'}`}>
          <article className="panel inventory-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Inventario actual</p>
                <h2>Control de saldos y valoración</h2>
              </div>
              <Eye size={20} />
            </div>

            <div className="table-wrap" ref={inventoryTableRef}>
              <ColumnFilterTable key={`${module}-${tallerSubmodulo || agroquimicosUbicacion || 'todos'}`} className={`inventory-table ${isTallerModule ? 'taller-table' : ''}`} extraFilters={[
                ...(module === 'Agroquimicos' ? [] : [{ key: 'subcategory', label: 'Subcategoría', values: new Map(moduleInventory.map((item) => [item.id, item.subcategoria || 'Sin subcategoría'])) }]),
                { key: 'brand', label: 'Marca', values: new Map(moduleInventory.map((item) => [item.id, item.marca || 'Sin marca registrada'])) },
              ]}>
                <thead>
                  <tr>
                    <th className="col-code">Código</th>
                    <th className="col-desc">Descripción</th>
                    {isTallerModule ? (
                      <>
                        <th className="numeric">Total</th>
                        <th className="numeric">Disponibles</th>
                        <th className="numeric">Ocupados</th>
                      </>
                    ) : module === 'Agroquimicos' ? (
                      <>
                        <th className="col-ref">Ubicación</th>
                        <th className="col-ref">Subcategoría</th>
                        <th className="numeric">Entradas</th>
                        <th className="numeric">Salidas</th>
                        <th className="numeric">Saldo</th>
                      </>
                    ) : isLubricantesTallerModule ? (
                      <>
                        <th className="numeric">Entradas</th>
                        <th className="numeric">Salidas</th>
                        <th className="numeric">Saldo</th>
                      </>
                    ) : (
                      <>
                        <th className="col-ref">{module === 'ASEO' ? 'Ubicación' : 'Referencia'}</th>
                        <th className="numeric">Entradas</th>
                        <th className="numeric">Salidas</th>
                        <th className="numeric">Saldo</th>
                      </>
                    )}
                    <th className="numeric col-valuation-unit">Valor unitario</th>
                    <th className="numeric col-valuation-total">Valor total</th>
                    <th className="col-unit">Unidad</th>
                    <th className="col-status">Estado</th>
                  </tr>
                </thead>
                <tbody key={`inventory-body-${module}-${tallerSubmodulo || agroquimicosUbicacion || 'todos'}`}>
                  {isTallerModule
                    ? moduleInventory.map((item) => {
                      const currentStatusValue = statusValueForItem(item);
                      const status = statusFor(item, currentStatusValue);
                      const nextStatus = normalize(currentStatusValue).includes('mant') ? 'Bueno' : 'Mantenimiento';
                      const statusSaving = isTallerStatusBusy(tallerStatusState, item.id);
                      const statusError = tallerStatusState.errors[item.id];
                      return (
                        <tr key={item.id}>
                          <td className="code col-code">{item.codigoQr ? item.codigoQr : item.codigo}</td>
                          <td className="col-desc">{item.descripcion}</td>
                          <td className="numeric">{formatNumber(item.total ?? item.saldo)}</td>
                          <td className={balanceClassName(item.saldo)}>{formatNumber(item.saldo)}</td>
                          <td className="numeric">{formatNumber(item.ocupados ?? 0)}</td>
                          {renderValuationCells(item)}
                          <td className="col-unit">{item.unidad}</td>
                          <td className="col-status" data-filter-value={status.label}>
                            <span className={`status ${status.className}`}>{status.label}</span>
                            <button
                              className="status-toggle-button"
                              type="button"
                              disabled={statusSaving}
                              onClick={() => toggleTallerStatus(item)}
                              title={`Cambiar estado a ${nextStatus}`}
                            >
                              {statusSaving ? 'Guardando...' : `A ${nextStatus}`}
                            </button>
                            {statusError && <small className="status-update-error">{statusError}</small>}
                          </td>
                        </tr>
                      );
                    })
                    : module === 'Agroquimicos'
                      ? moduleInventory.map((item) => {
                        const itemTotals = totalsForItem(item, totals);
                        const status = statusFor(item);
                        return (
                          <tr key={item.id}>
                            <td className="code col-code">{item.codigo}</td>
                            <td className="col-desc">{item.descripcion}</td>
                            <td className="col-ref" data-filter-value={item.ubicacion || 'Sin ubicación'}>
                              <AgrochemicalLocationSelect
                                location={item.ubicacion || ''}
                                productLabel={`${item.codigo} · ${item.descripcion}`}
                                blockedReason={!online
                                  ? 'Conéctate a internet para cambiar la ubicación.'
                                  : !isServerSourceReady(firestoreSources.inventory)
                                    ? 'Esperando sincronización con Firestore.'
                                    : ''}
                                onSave={(location) => saveAgrochemicalLocation({
                                  db,
                                  productId: item.id,
                                  expectedLocation: item.ubicacion || '',
                                  location,
                                  online,
                                  sourceReady: isServerSourceReady(firestoreSources.inventory),
                                })}
                              />
                            </td>
                            <td className="col-ref">{item.subcategoria || 'Sin subcategoría'}</td>
                            <td className="numeric">{formatNumber(itemTotals.entradas)}</td>
                            <td className="numeric">{formatNumber(itemTotals.salidas)}</td>
                            <td className={balanceClassName(item.saldo)}>{formatNumber(item.saldo)}</td>
                            {renderValuationCells(item)}
                            <td className="col-unit">{item.unidad}</td>
                            <td className="col-status"><span className={`status ${status.className}`}>{status.label}</span></td>
                          </tr>
                        );
                      }) : isLubricantesTallerModule
                      ? moduleInventory.map((item) => {
                        const itemTotals = totalsForItem(item, totals);
                        const status = statusFor(item);
                        return (
                          <tr key={item.id}>
                            <td className="code col-code">{item.codigo}</td>
                            <td className="col-desc">{item.descripcion}</td>
                            <td className="numeric">{formatNumber(itemTotals.entradas)}</td>
                            <td className="numeric">{formatNumber(itemTotals.salidas)}</td>
                            <td className={balanceClassName(item.saldo)}>{formatNumber(item.saldo)}</td>
                            {renderValuationCells(item)}
                            <td className="col-unit">{item.unidad}</td>
                            <td className="col-status"><span className={`status ${status.className}`}>{status.label}</span></td>
                          </tr>
                        );
                      })
                      : moduleInventory.map((item) => {
                        const itemTotals = totalsForItem(item, totals);
                        const status = statusFor(item);
                        return (
                          <tr key={item.id}>
                            <td className="code col-code">{item.codigo}</td>
                            <td className="col-desc">{item.descripcion}</td>
                            <td className="col-ref">{item.referencia}</td>
                            <td className="numeric">{formatNumber(itemTotals.entradas)}</td>
                            <td className="numeric">{formatNumber(itemTotals.salidas)}</td>
                            <td className={balanceClassName(item.saldo)}>{formatNumber(item.saldo)}</td>
                            {renderValuationCells(item)}
                            <td className="col-unit">{item.unidad}</td>
                            <td className="col-status"><span className={`status ${status.className}`}>{status.label}</span></td>
                          </tr>
                        );
                      })}
                  {!loading && moduleInventory.length === 0 && (
                    <tr>
                      <td colSpan={inventoryColumnCount} className="empty-cell">
                        <div className="empty-state">
                          <PackageCheck size={28} />
                          <strong>Sin referencias en este módulo</strong>
                          <span>Prueba otro filtro o espera la siguiente sincronización de Firestore.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan={inventoryColumnCount} className="empty-cell">
                        <div className="loading-state">
                          <span className="loading-dot" />
                          <span>Cargando inventario desde Firestore...</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </ColumnFilterTable>
            </div>
          </article>

          <MovementPanel
            title={tallerMovementLabels?.salidas ?? 'Salidas'}
            icon={<ArrowUpRight size={19} />}
            movements={exits}
            tone="exit"
            showTallerDetails={isTallerModule}
            tallerSubmodulo={tallerSubmodulo}
            totalCount={filteredExits.length}
            limit={movementLimit}
            canShowMore={canShowMoreExits}
            hasMoreHistory={canLoadOlderFilteredHistory}
            loadingMore={loadingMoreMovements}
            onShowMore={() => { void showMoreExitMovements(); }}
            onEvidence={setEvidenceMovement}
            registeredBy={(movement) => userDisplayName(movement.responsableEntrega || movement.usuario, users)}
            emptyMessage={tallerMovementLabels?.salidasEmpty}
            controls={(
              <div className={`exit-filter-menu ${exitFiltersOpen ? 'open' : ''}`}>
                <div className="exit-filter-bar">
                  <button
                    className={`filter-toggle ${hasExitFilters ? 'active' : ''}`}
                    type="button"
                    aria-expanded={exitFiltersOpen}
                    onClick={() => setExitFiltersOpen((open) => !open)}
                  >
                    <SlidersHorizontal size={15} />
                    Filtros
                    <ChevronDown size={15} />
                  </button>
                  <span>{formatNumber(filteredExits.length)} {tallerMovementLabels?.salidasContador ?? 'salidas'}</span>
                </div>

                {exitFiltersOpen && (
                  <div className="exit-filters">
                    <label>
                      Desde
                      <input type="date" value={exitDateFrom} onChange={(event) => setExitDateFrom(event.target.value)} />
                    </label>
                    <label>
                      Hasta
                      <input type="date" value={exitDateTo} onChange={(event) => setExitDateTo(event.target.value)} />
                    </label>
                    <label className="wide">
                      Código
                      <input value={exitCode} onChange={(event) => setExitCode(event.target.value)} placeholder="Código interno o real" />
                    </label>
                    <label className="wide">
                      Persona
                      <input value={exitPerson} onChange={(event) => setExitPerson(event.target.value)} placeholder="Nombre o usuario" />
                    </label>
                    <label className="wide">
                      Item
                      <input value={exitItem} onChange={(event) => setExitItem(event.target.value)} placeholder="Código, nombre o talla" />
                    </label>
                    <div className="exit-filter-summary">
                      <button
                        type="button"
                        disabled={!hasExitFilters}
                        onClick={() => {
                          setExitDateFrom('');
                          setExitDateTo('');
                          setExitCode('');
                          setExitPerson('');
                          setExitItem('');
                        }}
                      >
                        <X size={14} />
                        Limpiar filtros
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          />
        </section>
        )}
      </section>
      {evidenceMovement && (
        <EvidenceModal
          movement={evidenceMovement}
          registeredBy={userDisplayName(evidenceMovement.usuario, users)}
          onClose={() => setEvidenceMovement(null)}
        />
      )}
      {showEntriesModal && (
        <EntriesModal
          module={module}
          movements={allEntries}
          totalCount={allEntries.length}
          limit={entryModalLimit}
          showAll={hasExitFilters}
          hasMoreHistory={canLoadOlderFilteredHistory}
          loadingMoreHistory={loadingMoreMovements}
          onLoadMoreHistory={loadMoreMovementHistory}
          showTallerDetails={isTallerModule}
          tallerSubmodulo={tallerSubmodulo}
          entryTitle={tallerMovementLabels?.entradas ?? 'Entradas'}
          emptyMessage={tallerMovementLabels?.entradasEmpty}
          onEvidence={setEvidenceMovement}
          onClose={() => setShowEntriesModal(false)}
        />
      )}
      {showOccupiedModal && isTallerModule && (
        <OccupiedModal
          groups={occupiedGroups}
          totalCount={occupiedUnitCards.length}
          onClose={() => setShowOccupiedModal(false)}
        />
      )}
      {showAgrochemicalExpirationModal && isAgroquimicosModule && (
        <AgrochemicalExpirationModal
          products={agrochemicalExpirationProducts}
          lots={agrochemicalLots}
          entries={agrochemicalStockEntries}
          loading={agrochemicalLotsLoading}
          sourceError={agrochemicalLotsError}
          onRegister={registerAgrochemicalLot}
          onClose={() => setShowAgrochemicalExpirationModal(false)}
        />
      )}
      {valuationEditItem && (
        <ValuationEditModal
          product={valuationEditItem.descripcion}
          code={valuationEditItem.codigoQr || valuationEditItem.codigo}
          unit={valuationEditItem.unidad}
          moduleName={valuationModuleForItem(valuationEditItem)}
          quantity={valuationQuantity(valuationEditItem)}
          value={valuationDrafts[valuationEditItem.valuationId] ?? String(valuations[valuationEditItem.valuationId] ?? 0)}
          saveState={valuationSaveStates[valuationEditItem.valuationId]}
          saveBlockedReason={manualValuationBlockedReason(valuationEditItem)}
          conflict={valuationConflicts[valuationEditItem.valuationId]}
          onChange={(value) => updateValuationDraft(valuationEditItem, value)}
          onReload={() => reloadValuationConflict(valuationEditItem)}
          onSave={() => { void saveValuationModal(); }}
          onClose={closeValuationModal}
        />
      )}
      {showPendingUsers && canManageUsers && (
        <PendingUsersPanel
          users={Object.values(users).filter((profile, index, profiles) => profiles.findIndex((candidate) => candidate.id === profile.id) === index).sort((left, right) => {
            const leftPending = left.estado === 'pendiente' ? 0 : 1;
            const rightPending = right.estado === 'pendiente' ? 0 : 1;
            return leftPending - rightPending || left.email.localeCompare(right.email);
          })}
          onClose={() => setShowPendingUsers(false)}
          onSave={saveUserProfile}
        />
      )}
      {/* Assign QR modal removed: items without code only show availability status */}
    </main>
  );
}

function movementDetailText(movement: Movement) {
  // For Combustible and other modules: show labor/frente as main detail
  const main = movement.labor || movement.frente || movement.cargo;
  if (!main) return '';
  // Only append cargo if it's different and useful
  if (movement.cargo && movement.cargo !== main) {
    return `${main} | ${movement.cargo}`;
  }
  return main;
}

function movementSubmoduleText(movement: Movement, tallerSubmodulo: string) {
  if (
    esBodegaRojaTaller(tallerSubmodulo) &&
    esTrasladoMovimiento(movement) &&
    esSalidaVistaTaller(movement, tallerSubmodulo)
  ) {
    return movement.submodulo ? `Destino: ${movement.submodulo}` : '';
  }
  if (movement.submodulo) return `Submódulo: ${movement.submodulo}`;
  if (movement.submoduloOrigen) return `Origen: ${movement.submoduloOrigen}`;
  if (movement.maquinaria) return `Submódulo: ${movement.maquinaria}`;
  return '';
}

function MovementList({
  movements,
  tone,
  onEvidence,
  registeredBy,
  showTallerDetails = false,
  tallerSubmodulo = '',
  emptyMessage,
}: {
  movements: Movement[];
  tone: 'entry' | 'exit';
  onEvidence?: (movement: Movement) => void;
  registeredBy?: (movement: Movement) => string;
  showTallerDetails?: boolean;
  tallerSubmodulo?: string;
  emptyMessage?: string;
}) {
  const defaultEmpty = tone === 'entry' ? 'Sin entradas registradas' : 'Sin salidas en este periodo';
  const defaultHint = tone === 'entry'
    ? 'Las entradas aparecerán aquí cuando se registren desde la app Android.'
    : 'Ajusta los filtros o espera nuevos movimientos de salida.';

  return (
    <div className="movement-list">
      {movements.map((movement) => (
        <div className="movement-row" key={movement.id}>
          <div>
            <strong>{movement.codigo || 'Sin código'}</strong>
            <span>{movement.descripcion}</span>
            {showTallerDetails && movement.tipo && <small>Tipo: {movement.tipo}</small>}
            {showTallerDetails && movementSubmoduleText(movement, tallerSubmodulo) && (
              <small>{movementSubmoduleText(movement, tallerSubmodulo)}</small>
            )}
            <small>{tone === 'entry' ? 'Registra' : 'Solicitante'}: {movement.solicitante || 'Sin responsable'}</small>

            {/* Horómetro y contexto operativo - especialmente importante para Combustible */}
            {movement.horometro && <small><strong>Horómetro:</strong> {movement.horometro}</small>}
            {(movement.labor || movement.frente) && (
              <small><strong>Labor/Frente:</strong> {[movement.labor, movement.frente].filter(Boolean).join(' / ')}</small>
            )}
            {movement.maquinaria && <small><strong>Maquinaria/Equipo:</strong> {movement.maquinaria}</small>}
            {movement.zona && !movement.frente && <small><strong>Zona:</strong> {movement.zona}</small>}
            {movementDetailText(movement) && !movement.labor && !movement.frente && (
              <small>Detalle: {movementDetailText(movement)}</small>
            )}

            {tone === 'exit' && <small className="movement-user">Registra: {registeredBy?.(movement) || movement.usuario || 'Sin usuario'}</small>}
          </div>
          <div className="movement-meta">
            <strong className="movement-qty">{formatNumber(movement.cantidad)}</strong>
            <span className="movement-qty">{movement.unidad || 'Unidad'}</span>
            <span>{movement.fecha || 'Sin fecha'}</span>
            <button
              className="evidence-button"
              type="button"
              title={movement.fotoUrl ? 'Ver evidencia' : 'Sin evidencia'}
              disabled={!movement.fotoUrl || !onEvidence}
              onClick={() => onEvidence?.(movement)}
            >
              <Camera size={14} />
              Evidencia
            </button>
          </div>
        </div>
      ))}
      {movements.length === 0 && (
        <div className="empty-list">
          <Inbox size={26} />
          <strong>{emptyMessage || defaultEmpty}</strong>
          <span>{emptyMessage ? 'Los movimientos aparecerán aquí cuando se registren desde la app Android.' : defaultHint}</span>
        </div>
      )}
    </div>
  );
}

function MovementPanel({
  title,
  icon,
  movements,
  tone,
  onEvidence,
  registeredBy,
  controls,
  showTallerDetails = false,
  tallerSubmodulo = '',
  emptyMessage,
  totalCount,
  limit,
  canShowMore = false,
  hasMoreHistory = false,
  loadingMore = false,
  onShowMore,
}: {
  title: string;
  icon: ReactNode;
  movements: Movement[];
  tone: 'entry' | 'exit';
  onEvidence?: (movement: Movement) => void;
  registeredBy?: (movement: Movement) => string;
  controls?: ReactNode;
  showTallerDetails?: boolean;
  tallerSubmodulo?: string;
  emptyMessage?: string;
  totalCount?: number;
  limit?: number;
  canShowMore?: boolean;
  hasMoreHistory?: boolean;
  loadingMore?: boolean;
  onShowMore?: () => void;
}) {
  const truncated = typeof totalCount === 'number' && totalCount > movements.length;
  const remainingLoaded = typeof totalCount === 'number'
    ? Math.max(totalCount - movements.length, 0)
    : 0;
  const nextVisibleCount = Math.min(limit ?? 24, remainingLoaded);

  return (
    <article className={`panel movement-panel ${tone}`}>
      <div className="panel-header compact">
        <div>
          <p className="eyebrow">Actualizable</p>
          <h2>{title}</h2>
          {truncated && <small className="movement-truncated">Mostrando {movements.length} de {totalCount}</small>}
        </div>
        {icon}
      </div>
      {controls}
      <MovementList
        movements={movements}
        tone={tone}
        onEvidence={onEvidence}
        registeredBy={registeredBy}
        showTallerDetails={showTallerDetails}
        tallerSubmodulo={tallerSubmodulo}
        emptyMessage={emptyMessage}
      />
      {canShowMore && onShowMore && (
        <div className="movement-pagination-actions">
          <button type="button" disabled={loadingMore} onClick={onShowMore}>
            {loadingMore
              ? 'Cargando movimientos...'
              : remainingLoaded > 0
                ? `Mostrar ${nextVisibleCount} más`
                : hasMoreHistory
                  ? 'Buscar movimientos anteriores'
                  : 'Mostrar más'}
          </button>
        </div>
      )}
    </article>
  );
}

function EntriesModal({
  module,
  movements,
  totalCount,
  limit,
  showAll = false,
  hasMoreHistory = false,
  loadingMoreHistory = false,
  onLoadMoreHistory,
  showTallerDetails,
  tallerSubmodulo = '',
  entryTitle = 'Entradas',
  emptyMessage,
  onEvidence,
  onClose,
}: {
  module: string;
  movements: Movement[];
  totalCount: number;
  limit: number;
  showAll?: boolean;
  hasMoreHistory?: boolean;
  loadingMoreHistory?: boolean;
  onLoadMoreHistory?: () => Promise<void>;
  showTallerDetails: boolean;
  tallerSubmodulo?: string;
  entryTitle?: string;
  emptyMessage?: string;
  onEvidence: (movement: Movement) => void;
  onClose: () => void;
}) {
  const [visibleLimit, setVisibleLimit] = useState(limit);
  const displayCount = movementDisplayCount(totalCount, visibleLimit, showAll);
  const visibleMovements = movements.slice(0, displayCount);
  const truncated = totalCount > visibleMovements.length;
  const canShowMore = truncated || hasMoreHistory;
  const nextVisibleCount = Math.min(limit, Math.max(totalCount - visibleMovements.length, 0));

  useEffect(() => {
    setVisibleLimit(limit);
  }, [limit, module, showAll, tallerSubmodulo]);

  async function showMoreEntries() {
    if (truncated) {
      setVisibleLimit((current) => nextMovementDisplayLimit(current, limit));
      return;
    }
    if (!hasMoreHistory || !onLoadMoreHistory) return;
    if (!showAll) {
      setVisibleLimit((current) => nextMovementDisplayLimit(current, limit));
    }
    await onLoadMoreHistory();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="entries-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${entryTitle} de ${module}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="evidence-header">
          <div>
            <p className="eyebrow">{module} | Movimientos</p>
            <h2>{entryTitle} ({formatNumber(totalCount)})</h2>
            {truncated && <small className="movement-truncated">Mostrando {visibleMovements.length} de {totalCount}</small>}
          </div>
          <button className="icon-button" type="button" title="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="entries-modal-body">
          <MovementList
            movements={visibleMovements}
            tone="entry"
            onEvidence={onEvidence}
            showTallerDetails={showTallerDetails}
            tallerSubmodulo={tallerSubmodulo}
            emptyMessage={emptyMessage}
          />
          {canShowMore && (
            <div className="movement-pagination-actions modal-actions">
              <button type="button" disabled={loadingMoreHistory} onClick={() => { void showMoreEntries(); }}>
                {loadingMoreHistory
                  ? 'Cargando movimientos...'
                  : truncated
                    ? `Mostrar ${nextVisibleCount} más`
                    : 'Buscar entradas anteriores'}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function OccupiedModal({
  groups,
  totalCount,
  onClose,
}: {
  groups: OccupiedSubmoduleGroup[];
  totalCount: number;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="occupied-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Ítems en uso"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="evidence-header">
          <div>
            <p className="eyebrow">Taller | No disponibles</p>
            <h2>En uso ({formatNumber(totalCount)})</h2>
          </div>
          <button className="icon-button" type="button" title="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="occupied-modal-body">
          {groups.length === 0 && (
            <div className="occupied-empty">No hay ítems ocupados actualmente.</div>
          )}
          {groups.map((group) => (
            <section className="occupied-submodule-section" key={group.submodulo}>
              <header className="occupied-submodule-header">
                <h3>{group.submodulo}</h3>
                <span>{formatNumber(group.items.length)} en uso</span>
              </header>
              <div className="occupied-grid">
                {group.items.map((item) => (
                  <article className="occupied-card" key={item.id}>
                    <strong className="occupied-card-code">{item.codigo}</strong>
                    <span className="occupied-card-title">{item.descripcion}</span>
                    {item.subcategoria && <small>{item.subcategoria}</small>}
                    {item.caracteristica && <small>{item.caracteristica}</small>}
                    <small className="occupied-card-user">{item.solicitante}</small>
                    {item.unitTotal > 1 && (
                      <small className="occupied-card-unit">Unidad {item.unitIndex} de {item.unitTotal}</small>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function EvidenceModal({ movement, registeredBy, onClose }: { movement: Movement; registeredBy: string; onClose: () => void }) {
  const canPreview = canPreviewEvidence(movement.fotoUrl);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="evidence-modal" role="dialog" aria-modal="true" aria-label="Evidencia de salida" onClick={(event) => event.stopPropagation()}>
        <header className="evidence-header">
          <div>
            <p className="eyebrow">Evidencia</p>
            <h2>{movement.codigo || 'Salida'}</h2>
          </div>
          <button className="icon-button" type="button" title="Cerrar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="evidence-body">
          {canPreview ? (
            <img src={movement.fotoUrl} alt={`Evidencia de ${movement.descripcion}`} referrerPolicy="no-referrer" />
          ) : (
            <div className="evidence-empty">
              <Camera size={30} />
              <span>Evidencia pendiente</span>
            </div>
          )}
        </div>

        <footer className="evidence-footer">
          <div>
            <strong>{movement.descripcion}</strong>
            <span>{movement.solicitante || movement.cargo || 'Sin responsable'} | {registeredBy || movement.usuario || 'Sin usuario'} | {movement.fecha || 'Sin fecha'}</span>
          </div>
          {canPreview && (
            <a className="evidence-link" href={movement.fotoUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Abrir
            </a>
          )}
        </footer>
      </section>
    </div>
  );
}

function AuthorizationBlockedScreen({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <main className="loading-screen authorization-blocked">
      <ShieldCheck size={34} />
      <strong>{failed ? 'No se pudo confirmar la autorización' : 'Acceso no autorizado'}</strong>
      <span>{failed
        ? 'Se necesita conexión con Firestore para validar tu usuario antes de mostrar el panel.'
        : 'Tu usuario debe estar activo y tener un rol permitido.'}</span>
      <div>
        {failed && <button type="button" onClick={onRetry}>Reintentar</button>}
        <button type="button" onClick={() => { void signOut(auth); }}>Cerrar sesión</button>
      </div>
    </main>
  );
}

type AuthorizationStatus = 'idle' | 'checking' | 'authorized' | 'denied' | 'error';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [authorizationStatus, setAuthorizationStatus] = useState<AuthorizationStatus>('idle');
  const [authorizationAttempt, setAuthorizationAttempt] = useState(0);

  useEffect(() => {
    removeLegacyPanelCache(window.localStorage);
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthorizationStatus(currentUser ? 'checking' : 'idle');
      setChecking(false);
    });
  }, []);
  
    // Monitorear cambios de rol del usuario en tiempo real
    useUserRoleListener(user, () => {
      // Callback cuando el usuario es desautorizado
      setUser(null);
      setAuthorizationStatus('denied');
    });

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    setAuthorizationStatus('checking');
    verifyUserAuthorization(db, user)
      .then((authorized) => {
        if (active) setAuthorizationStatus(authorized ? 'authorized' : 'denied');
      })
      .catch((error) => {
        console.error('No pude confirmar la autorización del usuario:', error);
        if (active) setAuthorizationStatus('error');
      });
    return () => {
      active = false;
    };
  }, [authorizationAttempt, user]);

  if (checking || (user && authorizationStatus === 'checking')) {
    return <main className="loading-screen">Verificando autorización...</main>;
  }

  if (!user) {
    return (
      <LoginScreen
        onLogin={(email, password) => signInWithNormalizedEmail(auth, db, email, password)}
        onRegister={(email, password, name, jobTitle) => createCorporateAccount(auth, db, email, password, name, jobTitle)}
      />
    );
  }

  if (authorizationStatus !== 'authorized') {
    return (
      <AuthorizationBlockedScreen
        failed={authorizationStatus === 'error'}
        onRetry={() => setAuthorizationAttempt((attempt) => attempt + 1)}
      />
    );
  }

  return <AppShell key={`${firebaseProjectId}:${user.uid}`} user={user} />;
}
