import { normalizeMovementText } from '../movementView';
import { classifyInventoryMovementType } from './engine';
import type { InventoryAnalysisMovement, InventoryAnalysisProduct } from './models';

export type InventoryAnalysisSourceProduct = {
  id: string;
  module: string;
  code: string;
  name: string;
  reference: string;
  category: string;
  unit: string;
  location?: string;
  currentStock?: number;
  expirationDate?: string | null;
  confirmedObsolete?: boolean;
};

export type InventoryAnalysisSourceMovement = {
  id: string;
  module: string;
  type: string;
  code: string;
  name: string;
  reference: string;
  quantity: number;
  occurredAt: string;
  productDocumentId?: string;
  stockBefore?: number | null;
  stockAfter?: number | null;
};

export type InventoryAnalysisAdaptedData = {
  products: InventoryAnalysisProduct[];
  movements: InventoryAnalysisMovement[];
  unresolvedMovementIds: string[];
  ambiguousMovementIds: string[];
};

function sourceForProductId(id: string) {
  if (id.startsWith('aseo-')) return { collection: 'productos_aseo', documentId: id.replace(/^aseo-/, '') };
  if (id.startsWith('herramienta-')) return { collection: 'herramientas', documentId: id.replace(/^herramienta-/, '') };
  return { collection: 'existencias', documentId: id };
}

function sourceCollectionForModule(module: string) {
  const normalized = normalizeMovementText(module).replace(/\s+/g, '');
  if (normalized === 'aseo') return 'productos_aseo';
  if (normalized === 'taller' || normalized.includes('herramienta')) return 'herramientas';
  return 'existencias';
}

function stableProductId(collection: string, documentId: string) {
  return `${collection}__${encodeURIComponent(documentId)}`;
}

function moduleKey(module: string) {
  return normalizeMovementText(module).replace(/\s+/g, '');
}

function codeKey(module: string, code: string) {
  const normalizedCode = normalizeMovementText(code);
  return normalizedCode ? `${moduleKey(module)}|${normalizedCode}` : '';
}

function descriptionKey(module: string, name: string, reference: string) {
  const normalizedName = normalizeMovementText(name);
  if (!normalizedName) return '';
  return `${moduleKey(module)}|${normalizedName}|${normalizeMovementText(reference)}`;
}

function addLookup(lookup: Map<string, string[]>, key: string, productId: string) {
  if (!key) return;
  const current = lookup.get(key) ?? [];
  if (!current.includes(productId)) lookup.set(key, [...current, productId]);
}

export function adaptInventoryAnalysisSources(
  sourceProducts: readonly InventoryAnalysisSourceProduct[],
  sourceMovements: readonly InventoryAnalysisSourceMovement[],
): InventoryAnalysisAdaptedData {
  const productByStableId = new Map<string, InventoryAnalysisProduct>();
  const productByDocumentId = new Map<string, string[]>();
  const productByCode = new Map<string, string[]>();
  const productByDescription = new Map<string, string[]>();

  sourceProducts.forEach((sourceProduct) => {
    const source = sourceForProductId(sourceProduct.id);
    const id = stableProductId(source.collection, source.documentId);
    const product: InventoryAnalysisProduct = {
      id,
      code: sourceProduct.code,
      name: sourceProduct.name,
      category: sourceProduct.category,
      unit: sourceProduct.unit,
      module: sourceProduct.module,
      location: sourceProduct.location,
      currentStock: sourceProduct.currentStock,
      expirationDate: sourceProduct.expirationDate,
      confirmedObsolete: sourceProduct.confirmedObsolete,
    };
    productByStableId.set(id, product);
    addLookup(productByDocumentId, `${source.collection}|${source.documentId}`, id);
    addLookup(productByCode, codeKey(sourceProduct.module, sourceProduct.code), id);
    addLookup(productByDescription, descriptionKey(
      sourceProduct.module,
      sourceProduct.name,
      sourceProduct.reference,
    ), id);
  });

  const movements: InventoryAnalysisMovement[] = [];
  const unresolvedMovementIds: string[] = [];
  const ambiguousMovementIds: string[] = [];

  sourceMovements.forEach((sourceMovement) => {
    const candidates: string[][] = [];
    if (sourceMovement.productDocumentId?.trim()) {
      candidates.push(productByDocumentId.get(
        `${sourceCollectionForModule(sourceMovement.module)}|${sourceMovement.productDocumentId.trim()}`,
      ) ?? []);
    }
    candidates.push(productByCode.get(codeKey(sourceMovement.module, sourceMovement.code)) ?? []);
    candidates.push(productByDescription.get(descriptionKey(
      sourceMovement.module,
      sourceMovement.name,
      sourceMovement.reference,
    )) ?? []);

    const firstMatch = candidates.find((entries) => entries.length > 0) ?? [];
    if (firstMatch.length !== 1) {
      if (firstMatch.length > 1) ambiguousMovementIds.push(sourceMovement.id);
      else unresolvedMovementIds.push(sourceMovement.id);
      return;
    }
    movements.push({
      id: sourceMovement.id,
      productId: firstMatch[0],
      occurredAt: sourceMovement.occurredAt,
      kind: classifyInventoryMovementType(sourceMovement.type),
      quantity: sourceMovement.quantity,
      stockBefore: sourceMovement.stockBefore,
      stockAfter: sourceMovement.stockAfter,
    });
  });

  return {
    products: [...productByStableId.values()],
    movements,
    unresolvedMovementIds,
    ambiguousMovementIds,
  };
}
