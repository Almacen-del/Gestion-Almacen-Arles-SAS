import type {
  CurrentValuationRow,
  CurrentValuationSummary,
  ValuationFilter,
  ValuationModuleSummary,
} from './models';

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}
export function filterCurrentValuationRows(
  rows: CurrentValuationRow[],
  search: string,
  moduleFilter: string,
  valueFilter: ValuationFilter,
) {
  const query = normalize(search);

  return rows.filter((row) => {
    const hasValue = row.unitValue > 0;
    const matchesModule = moduleFilter === 'all' || row.moduleName === moduleFilter;
    const matchesValue = valueFilter === 'all'
      || (valueFilter === 'valued' ? hasValue : !hasValue);
    const matchesSearch = !query || normalize([
      row.moduleName,
      row.code,
      row.product,
      row.reference,
      row.unit,
    ].join(' ')).includes(query);

    return matchesModule && matchesValue && matchesSearch;
  });
}

export function summarizeCurrentValuation(
  rows: CurrentValuationRow[],
  moduleOptions: string[],
): CurrentValuationSummary {
  let valuedProductCount = 0;
  let inventoryGrandTotal = 0;
  const totalsByModule = new Map<string, ValuationModuleSummary>(
    moduleOptions.map((moduleName) => [moduleName, {
      moduleName,
      productCount: 0,
      valuedCount: 0,
      total: 0,
    }]),
  );

  rows.forEach((row) => {
    const moduleTotal = totalsByModule.get(row.moduleName);
    inventoryGrandTotal += row.totalValue;
    if (row.unitValue > 0) valuedProductCount += 1;
    if (!moduleTotal) return;
    moduleTotal.productCount += 1;
    moduleTotal.total += row.totalValue;
    if (row.unitValue > 0) moduleTotal.valuedCount += 1;
  });

  const productCount = rows.length;
  return {
    productCount,
    valuedProductCount,
    unvaluedProductCount: productCount - valuedProductCount,
    valuedPercentage: productCount > 0 ? (valuedProductCount / productCount) * 100 : 0,
    inventoryGrandTotal,
    moduleTotals: moduleOptions.map((moduleName) => totalsByModule.get(moduleName)!),
  };
}
