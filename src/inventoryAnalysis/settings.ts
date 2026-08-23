import {
  DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS,
  normalizeInventoryAnalysisThresholds,
} from './classification';
import type { InventoryAnalysisThresholds } from './models';

const PREVIOUS_INVENTORY_ANALYSIS_SETTINGS_KEY = 'gestion-almacen:inventory-analysis-thresholds:v1';
export const INVENTORY_ANALYSIS_SETTINGS_KEY = 'gestion-almacen:inventory-analysis-thresholds:v2';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadInventoryAnalysisThresholds(storage: StorageLike): InventoryAnalysisThresholds {
  try {
    const stored = storage.getItem(INVENTORY_ANALYSIS_SETTINGS_KEY);
    if (stored) return normalizeInventoryAnalysisThresholds(JSON.parse(stored) as Partial<InventoryAnalysisThresholds>);
    const previous = storage.getItem(PREVIOUS_INVENTORY_ANALYSIS_SETTINGS_KEY);
    if (!previous) return DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS;
    const migrated = normalizeInventoryAnalysisThresholds({
      ...(JSON.parse(previous) as Partial<InventoryAnalysisThresholds>),
      nearExpiryDays: DEFAULT_INVENTORY_ANALYSIS_THRESHOLDS.nearExpiryDays,
    });
    storage.setItem(INVENTORY_ANALYSIS_SETTINGS_KEY, JSON.stringify(migrated));
    return migrated;
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
