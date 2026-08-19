import {
  DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS,
  normalizeInventoryAnalysisThresholds,
} from './classification';
import type { InventoryAnalysisThresholds } from './models';

export const INVENTORY_ANALYSIS_SETTINGS_KEY = 'gestion-almacen:inventory-analysis-thresholds:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadInventoryAnalysisThresholds(storage: StorageLike): InventoryAnalysisThresholds {
  try {
    const stored = storage.getItem(INVENTORY_ANALYSIS_SETTINGS_KEY);
    if (!stored) return DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS;
    return normalizeInventoryAnalysisThresholds(JSON.parse(stored) as Partial<InventoryAnalysisThresholds>);
  } catch {
    return DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS;
  }
}

export function saveInventoryAnalysisThresholds(
  storage: StorageLike,
  thresholds: Partial<InventoryAnalysisThresholds>,
) {
  const normalized = normalizeInventoryAnalysisThresholds(thresholds);
  storage.setItem(INVENTORY_ANALYSIS_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}
