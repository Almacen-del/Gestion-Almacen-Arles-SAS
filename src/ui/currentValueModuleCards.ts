import { isInventoryValuationModuleIncluded } from '../valuation/inventoryValuationScope';

export function shouldShowCurrentValueModuleCard(moduleName: string) {
  return isInventoryValuationModuleIncluded(moduleName);
}
