import { classifyInventoryMovementType } from '../inventoryAnalysis/engine';
import {
  adaptInventoryAnalysisSources,
  type InventoryAnalysisSourceMovement,
  type InventoryAnalysisSourceProduct,
} from '../inventoryAnalysis/sourceAdapter';
import type { CurrentValuationRow } from './models';

export type EstimatedExitExpense = {
  estimatedTotal: number;
  exitCount: number;
  valuedExitCount: number;
  unvaluedExitCount: number;
  unresolvedExitCount: number;
  missingValuations: Array<{
    productId: string;
    code: string;
    product: string;
    moduleName: string;
    exitCount: number;
  }>;
};

export function calculateEstimatedExitExpense(
  rows: readonly CurrentValuationRow[],
  products: readonly InventoryAnalysisSourceProduct[],
  movements: readonly InventoryAnalysisSourceMovement[],
): EstimatedExitExpense {
  const exitCount = movements.filter((movement) => (
    classifyInventoryMovementType(movement.type) === 'exit'
  )).length;
  const adapted = adaptInventoryAnalysisSources(products, movements);
  const valuationByProductId = new Map(rows.map((row) => [row.valuationId, row]));
  let estimatedTotal = 0;
  let valuedExitCount = 0;
  let unvaluedExitCount = 0;
  const productById = new Map(adapted.products.map((product) => [product.id, product]));
  const missingByProduct = new Map<string, EstimatedExitExpense['missingValuations'][number]>();

  adapted.movements.forEach((movement) => {
    if (movement.kind !== 'exit') return;
    const valuation = valuationByProductId.get(movement.productId);
    if (!valuation || valuation.unitValue <= 0) {
      unvaluedExitCount += 1;
      const product = productById.get(movement.productId);
      const current = missingByProduct.get(movement.productId);
      missingByProduct.set(movement.productId, {
        productId: movement.productId,
        code: valuation?.code ?? product?.code ?? 'Sin código',
        product: valuation?.product ?? product?.name ?? 'Producto no disponible',
        moduleName: valuation?.moduleName ?? product?.module ?? 'Sin módulo',
        exitCount: (current?.exitCount ?? 0) + 1,
      });
      return;
    }
    estimatedTotal += Math.max(0, movement.quantity) * valuation.unitValue;
    valuedExitCount += 1;
  });

  return {
    estimatedTotal,
    exitCount,
    valuedExitCount,
    unvaluedExitCount,
    unresolvedExitCount: Math.max(0, exitCount - valuedExitCount - unvaluedExitCount),
    missingValuations: [...missingByProduct.values()].sort((left, right) => (
      left.moduleName.localeCompare(right.moduleName)
      || left.code.localeCompare(right.code, undefined, { numeric: true })
      || left.product.localeCompare(right.product)
    )),
  };
}
