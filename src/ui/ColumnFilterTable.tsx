import { cloneElement, useEffect, useId, useMemo, useRef, useState, type ReactNode, type TableHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from 'lucide-react';
import { filterText, matchesColumnFilters, normalizeFilterSearch, tableElements, uniqueFilterValues, type ColumnSelections } from './columnFilters';
import './columnFilters.css';

export type ExtraTableFilter = { key: string; label: string; values: ReadonlyMap<string, string> };
type Column = { key: string; label: string; disabled?: boolean };
const NO_EXTRA_FILTERS: readonly ExtraTableFilter[] = [];

function FilterMenu({ column, options, selected, anchor, onApply, onClose }: {
  column: Column; options: string[]; selected?: readonly string[]; anchor: HTMLButtonElement;
  onApply: (values: string[] | undefined) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(() => new Set(selected ?? options));
  const menu = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const normalized = normalizeFilterSearch(query);
  const shown = options.filter((value) => normalizeFilterSearch(value || '(Sin dato)').includes(normalized));
  const allShown = shown.length > 0 && shown.every((value) => draft.has(value));
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 16);
  const height = Math.min(430, window.innerHeight - 16);
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8));

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [anchor, onClose]);

  return createPortal(<div ref={menu} className="column-filter-menu" role="dialog" aria-modal="true" aria-labelledby={titleId}
    style={{ left, top, width, maxHeight: height }} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const focusable = Array.from(menu.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header><strong id={titleId}>Filtrar {column.label}</strong><button type="button" aria-label="Cerrar filtro" onClick={onClose}><X size={16} /></button></header>
    <input autoFocus type="search" placeholder="Buscar valores…" aria-label={`Buscar en ${column.label}`} value={query} onChange={(event) => setQuery(event.target.value)} />
    <label className="column-filter-select-all"><input type="checkbox" checked={allShown} disabled={!shown.length} onChange={() => setDraft((current) => {
      const next = new Set(current); shown.forEach((value) => allShown ? next.delete(value) : next.add(value)); return next;
    })} />{normalized ? 'Seleccionar resultados' : 'Seleccionar todo'} <small>({shown.length})</small></label>
    <div className="column-filter-options">
      {shown.map((value) => <label key={value} title={value || '(Sin dato)'}><input type="checkbox" checked={draft.has(value)} onChange={() => setDraft((current) => {
        const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next;
      })} /><span>{value || '(Sin dato)'}</span></label>)}
      {!shown.length && <p>No hay valores que coincidan.</p>}
    </div>
    <footer><button type="button" onClick={() => onApply(undefined)}>Quitar filtro</button><button type="button" className="column-filter-apply" onClick={() => {
      const values = shown.filter((value) => draft.has(value));
      onApply(values.length === options.length ? undefined : values);
    }}>Aplicar</button></footer>
  </div>, document.body);
}

/** Filters the complete supplied tbody before pagination. Does not change source totals or records. */
export default function ColumnFilterTable({ children, pageSize, extraFilters = NO_EXTRA_FILTERS, ...props }: TableHTMLAttributes<HTMLTableElement> & {
  children: ReactNode; pageSize?: number; extraFilters?: readonly ExtraTableFilter[];
}) {
  const [filters, setFilters] = useState<ColumnSelections>({});
  const [visible, setVisible] = useState(pageSize ?? Infinity);
  const [opened, setOpened] = useState<{ column: Column; anchor: HTMLButtonElement } | null>(null);
  const parsed = useMemo(() => {
    const sections = tableElements(children);
    const head = sections.find((node) => node.type === 'thead');
    const body = sections.find((node) => node.type === 'tbody');
    const headerRow = tableElements(head?.props.children)[0];
    const headers = tableElements(headerRow?.props.children);
    const columns = headers.map((header, i) => ({ key: `column-${i}-${filterText(header)}`, label: filterText(header), disabled: header.props['data-filter-disabled'] }));
    const bodyRows = tableElements(body?.props.children);
    const rows = bodyRows.map((element) => {
      const cells = tableElements(element.props.children);
      const data = element.type === 'tr' && cells.length === columns.length && cells.every((cell) => !cell.props.colSpan || cell.props.colSpan === 1);
      const values: Record<string, string> = {};
      cells.forEach((cell, i) => { if (columns[i]) values[columns[i].key] = filterText(cell); });
      extraFilters.forEach((extra) => { values[`extra-${extra.key}`] = extra.values.get(String(element.key)) ?? ''; });
      return { element, data, values };
    });
    return { sections, head, body, headerRow, headers, columns, rows };
  }, [children, extraFilters]);
  const dataRows = parsed.rows.filter((row) => row.data);
  const matched = dataRows.filter((row) => matchesColumnFilters(row.values, filters));
  const activeCount = Object.keys(filters).length;
  const close = () => { opened?.anchor.focus({ preventScroll: true }); setOpened(null); };
  const trigger = (column: Column, content: ReactNode, extra = false) => <button type="button"
    className={`column-filter-trigger${filters[column.key] ? ' is-filtered' : ''}${extra ? ' is-extra' : ''}`}
    aria-label={`Filtrar ${column.label}${filters[column.key] ? ' (activo)' : ''}`} aria-haspopup="dialog" aria-expanded={opened?.column.key === column.key}
    title={`Filtrar ${column.label}`} onClick={(event) => setOpened(opened?.column.key === column.key ? null : { column, anchor: event.currentTarget })}>
    <span>{content}</span><Filter size={12} aria-hidden="true" />
  </button>;

  return <>
    <div className="column-filter-toolbar">
      <span title="Solo cambia las filas de esta tabla; los totales generales y los registros no se modifican.">Filtros por columna</span>
      {props.className?.includes('valuation-general-table') && <div className="column-filter-mobile">
        {parsed.columns.filter((column) => !column.disabled).map((column) => <span key={column.key}>{trigger(column, column.label, true)}</span>)}
      </div>}
      {extraFilters.map((extra) => <span key={extra.key}>{trigger({ key: `extra-${extra.key}`, label: extra.label }, extra.label, true)}</span>)}
      {activeCount > 0 && <><span role="status">{matched.length} de {dataRows.length} filas · {activeCount} filtro{activeCount === 1 ? '' : 's'}</span>
        <button type="button" onClick={() => { setFilters({}); setVisible(pageSize ?? Infinity); }}>Limpiar filtros</button></>}
    </div>
    <table {...props}>{parsed.sections.map((section) => {
      if (section === parsed.head && parsed.headerRow) return cloneElement(section, { key: 'filter-head' }, cloneElement(parsed.headerRow, {},
        parsed.headers.map((header, i) => cloneElement(header, { key: parsed.columns[i].key }, parsed.columns[i].disabled ? header.props.children : trigger(parsed.columns[i], header.props.children)))));
      if (section === parsed.body) return cloneElement(section, { key: 'filter-body' },
        matched.slice(0, visible).map((row) => row.element),
        parsed.rows.filter((row) => !row.data).map((row, i) => cloneElement(row.element, { key: row.element.key ?? `notice-${i}` })),
        dataRows.length > 0 && matched.length === 0 ? <tr><td colSpan={parsed.columns.length} className="empty-cell">No hay filas que coincidan. Cambia o limpia los filtros.</td></tr> : null);
      return section;
    })}</table>
    {pageSize && matched.length > 0 && <div className="column-filter-pagination"><span>Mostrando {Math.min(visible, matched.length)} de {matched.length} filas.</span>
      {visible < matched.length && <button type="button" onClick={() => setVisible((count) => count + pageSize)}>Mostrar {pageSize} más</button>}</div>}
    {opened && <FilterMenu key={opened.column.key} column={opened.column} anchor={opened.anchor} selected={filters[opened.column.key]}
      options={uniqueFilterValues(dataRows.filter((row) => matchesColumnFilters(row.values, Object.fromEntries(Object.entries(filters).filter(([key]) => key !== opened.column.key))))
        .map((row) => row.values[opened.column.key] ?? ''))}
      onClose={close} onApply={(values) => {
        setFilters((current) => { const next = { ...current }; if (values === undefined) delete next[opened.column.key]; else next[opened.column.key] = values; return next; });
        setVisible(pageSize ?? Infinity); close();
      }} />}
  </>;
}
