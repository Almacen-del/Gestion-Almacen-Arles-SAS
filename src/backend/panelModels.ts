import type {LoteMovimientoReporte} from '../reporteMovimientosExcel';
export type InventoryItem = {
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

export type OccupiedUnitCard = {
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

export type OccupiedSubmoduleGroup = {
  submodulo: string;
  items: OccupiedUnitCard[];
};

export type Movement = {
  hiddenFromOperationalHistory?: boolean;
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
  usuarioUid?: string;
  placaSerial?: string;
  proveedor?: string;
  entregaEntrada?: string;
  productDocumentId?: string;
  documentId?: string;
  stockBefore?: number;
  stockAfter?: number;
  lote?: string;
  fechaVencimiento?: string;
  lotesSalida?: LoteMovimientoReporte[];
};

export type UserProfile = {
  manageable?:boolean;
  id: string;
  nombre: string;
  cargo: string;
  email: string;
  rol: string;
  role?: string;
  estado: string;
  activo: boolean;
};
