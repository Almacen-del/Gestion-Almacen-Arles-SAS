import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';

type NodeProps = { children?: ReactNode; colSpan?: number; 'data-filter-value'?: string | number; 'data-filter-disabled'?: boolean };
export type TableNode = ReactElement<NodeProps>;
export type ColumnSelections = Record<string, readonly string[]>;

// Flatten fragments without replacing the original row keys or mounting new inputs.
export function tableElements(children: ReactNode): TableNode[] {
  const result: TableNode[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<NodeProps>(child)) return;
    if (child.type === Fragment) result.push(...tableElements(child.props.children));
    else result.push(child);
  });
  return result;
}

export function filterText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(filterText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!isValidElement<NodeProps>(node)) return '';
  if (node.props['data-filter-value'] !== undefined) return String(node.props['data-filter-value']).trim();
  if (node.type === 'svg' || node.type === 'input' || node.type === 'select') return '';
  return filterText(node.props.children);
}

export function normalizeFilterSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').trim();
}

export function matchesColumnFilters(values: Readonly<Record<string, string>>, filters: ColumnSelections): boolean {
  return Object.entries(filters).every(([key, selection]) => selection.includes(values[key] ?? ''));
}

export function uniqueFilterValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));
}
