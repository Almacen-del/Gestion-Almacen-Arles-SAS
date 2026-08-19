export type InventoryMovementKind = 'entry' | 'exit' | 'transfer' | 'adjustment' | 'unknown';

export type InventoryAnalysisProduct = {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  module: string;
  location?: string;
  currentStock?: number;
  expirationDate?: string | null;
  confirmedObsolete?: boolean;
};

export type InventoryAnalysisMovement = {
  id: string;
  productId: string;
  occurredAt: string;
  kind: InventoryMovementKind;
  quantity: number;
  stockBefore?: number | null;
  stockAfter?: number | null;
};

export type InventoryAnalysisPeriod = {
  from: string;
  to: string;
  historyCoverageFrom?: string;
};

export type InventoryAnalysisIssueCode =
  | 'invalid-period'
  | 'invalid-date'
  | 'invalid-quantity'
  | 'invalid-stock-anchor'
  | 'movement-anchor-mismatch'
  | 'missing-balance-anchor'
  | 'incomplete-balance-path'
  | 'conflicting-balance-anchors'
  | 'negative-balance'
  | 'period-before-history-coverage'
  | 'current-stock-mismatch';

export type InventoryAnalysisIssue = {
  code: InventoryAnalysisIssueCode;
  message: string;
  movementId?: string;
};

export type InventoryAnalysisQuality = 'exact' | 'insufficient' | 'inconsistent';

export type InventoryAnalysisEvidence = {
  openingAnchorMovementIds: string[];
  entryMovementIds: string[];
  exitMovementIds: string[];
  otherMovementIds: string[];
  lastEntryMovementId: string | null;
  lastExitMovementId: string | null;
};

export type InventoryPeriodAnalysis = {
  product: InventoryAnalysisProduct;
  period: InventoryAnalysisPeriod;
  openingInventory: number | null;
  entries: number;
  exits: number;
  otherChanges: number | null;
  closingInventory: number | null;
  averageInventory: number | null;
  turnover: number | null;
  lastEntryDate: string | null;
  lastExitDate: string | null;
  daysWithoutMovement: number | null;
  quality: InventoryAnalysisQuality;
  issues: InventoryAnalysisIssue[];
  evidence: InventoryAnalysisEvidence;
};

export type InventoryClassificationStatus =
  | 'normal'
  | 'low-turnover'
  | 'no-movement'
  | 'review'
  | 'possible-obsolescence'
  | 'confirmed-obsolete';

export type InventoryAnalysisThresholds = {
  lowTurnoverMaximum: number;
  lowTurnoverAfterDays: number;
  noMovementAfterDays: number;
  possibleObsolescenceAfterDays: number;
  nearExpiryDays: number;
};

export type InventoryClassification = {
  status: InventoryClassificationStatus;
  label: string;
  reasons: string[];
  expired: boolean;
  nearExpiry: boolean;
};
