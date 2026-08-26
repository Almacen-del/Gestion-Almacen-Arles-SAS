import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ColumnFilterTable from './ColumnFilterTable';
import { filterText, matchesColumnFilters, normalizeFilterSearch, tableElements, uniqueFilterValues } from './columnFilters';

describe('filtros de tablas', () => {
  it('combina columnas con AND y valores de la misma columna con OR', () => {
    const selection = { brand: ['A', 'B'], category: ['Fertilizante'] };
    expect(matchesColumnFilters({ brand: 'B', category: 'Fertilizante' }, selection)).toBe(true);
    expect(matchesColumnFilters({ brand: 'B', category: 'Insecticida' }, selection)).toBe(false);
    expect(matchesColumnFilters({ brand: 'C', category: 'Fertilizante' }, selection)).toBe(false);
  });
  it('no seleccionar ningún valor no muestra filas; quitar los filtros muestra todo', () => {
    expect(matchesColumnFilters({ name: 'A' }, { name: [] })).toBe(false);
    expect(matchesColumnFilters({ name: 'A' }, {})).toBe(true);
  });
  it('incluye valores vacíos y cero sin confundirlos', () => {
    expect(filterText(<td>{0}</td>)).toBe('0');
    expect(matchesColumnFilters({}, { brand: [''] })).toBe(true);
    expect(matchesColumnFilters({ brand: '0' }, { brand: [''] })).toBe(false);
  });
  it('busca sin tildes ni mayúsculas y ordena números naturalmente', () => {
    expect(normalizeFilterSearch('  DOTACIÓN ')).toBe('dotacion');
    expect(uniqueFilterValues(['10', '2', '2', ''])).toEqual(['', '2', '10']);
  });
  it('extrae texto visible compuesto y respeta el valor explícito de los campos editables', () => {
    expect(filterText(<td><strong>Producto</strong><small>Unidad</small></td>)).toBe('Producto Unidad');
    expect(filterText(<td data-filter-value="Pendiente"><input defaultValue="75" /><small>Guardando</small></td>)).toBe('Pendiente');
    expect(filterText(<td><input defaultValue="75" /></td>)).toBe('');
  });
  it('aplana fragmentos y conserva claves, eventos y componentes editables', () => {
    const input = <input defaultValue="12" />;
    const rows = tableElements(<>{false}{[<tr key="row-1"><td>{input}</td></tr>]}<><tr key="row-2" /></></>);
    expect(rows.map((row) => row.key)).toEqual(['row-1', 'row-2']);
    expect(tableElements(rows[0].props.children)[0].props.children).toBe(input);
  });
  it('renderiza todas las cabeceras fragmentadas, excepto las acciones, y pagina solo filas de datos', () => {
    const html = renderToStaticMarkup(<ColumnFilterTable pageSize={1}>
      <thead><tr><th>Nombre</th><><th>Marca</th><th data-filter-disabled>Acción</th></></tr></thead>
      <tbody>{['Uno', 'Dos'].map((name) => <tr key={name}><td>{name}</td><><td>A</td><td><button>Editar</button></td></></tr>)}</tbody>
    </ColumnFilterTable>);
    expect(html).toContain('Filtrar Nombre');
    expect(html).toContain('Filtrar Marca');
    expect(html).not.toContain('Filtrar Acción');
    expect(html).toContain('<td>Uno</td>');
    expect(html).not.toContain('<td>Dos</td>');
    expect(html).toContain('Mostrar 1 más');
  });
  it('conserva los estados de carga o vacío sin tratarlos como productos', () => {
    const html = renderToStaticMarkup(<ColumnFilterTable><thead><tr><th>Nombre</th><th>Marca</th></tr></thead><tbody><tr><td colSpan={2}>Cargando…</td></tr></tbody></ColumnFilterTable>);
    expect(html).toContain('Cargando…');
    expect(html).not.toContain('No hay filas que coincidan');
  });
});
