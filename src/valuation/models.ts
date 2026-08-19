export type ValuationSaveState = 'saving' | 'saved' | 'error' | 'conflict';

export type ValuationFilter = 'all' | 'valued' | 'unvalued';

export type CurrentValuationRow = {
  valuationId: string;
  moduleName: string;
  code: string;
  product: string;
  reference: string;
  quantity: number;
  unit: string;
  unitValue: number;
  totalValue: number;
  includesOccupied: boolean;
};
export type ValuationModuleSummary = {
  moduleName: string;
  productCount: number;
  valuedCount: number;
  total: number;
};

export type CurrentValuationSummary = {
  productCount: number;
  valuedProductCount: number;
  unvaluedProductCount: number;
  valuedPercentage: number;
  inventoryGrandTotal: number;
  moduleTotals: ValuationModuleSummary[];
};

export type MonthlyValuationSummary = {
  period: string;
  totalValue: number;
  productCount: number;
  valuedProductCount: number;
  unvaluedProductCount: number;
  valuedPercentage: number;
  moduleTotals: Record<string, number>;
  createdAt: Date | null;
  createdBy: string;
  createdByUid: string;
  status: 'guardando' | 'completo' | 'error';
};

export type MonthlyValuationItem = {
  id: string;
  moduleName: string;
  code: string;
  reference: string;
  product: string;
  quantity: number;
  unit: string;
  unitValue: number;
  totalValue: number;
};
