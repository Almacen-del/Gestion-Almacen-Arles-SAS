import { describe, expect, it } from 'vitest';
import { mergeMonthlyValuationSummaryPages } from './monthlyValuation';
import type { MonthlyValuationSummary } from './models';

function summary(period: string, totalValue: number): MonthlyValuationSummary {
  return {
    period,
    totalValue,
    productCount: 1,
    valuedProductCount: 1,
    unvaluedProductCount: 0,
    valuedPercentage: 100,
    moduleTotals: {},
    createdAt: null,
    createdBy: 'Pruebas',
    createdByUid: 'test-user',
    status: 'completo',
  };
}

describe('paginación del histórico mensual', () => {
  it('deduplica periodos, conserva la versión más reciente y ordena por cursor mensual', () => {
    const firstPage = [summary('2026-07', 70), summary('2026-06', 60)];
    const secondPage = [summary('2026-06', 61), summary('2026-05', 50)];

    const merged = mergeMonthlyValuationSummaryPages(firstPage, secondPage);

    expect(merged.map((entry) => entry.period)).toEqual(['2026-07', '2026-06', '2026-05']);
    expect(merged.find((entry) => entry.period === '2026-06')?.totalValue).toBe(61);
  });
});
