import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgrochemicalLocationSelect from './AgrochemicalLocationSelect';
import { filterText } from './columnFilters';

describe('desplegable de ubicación', () => {
  it('muestra las ubicaciones disponibles, selecciona la actual y no guarda al renderizar', () => {
    const onSave = vi.fn();
    const html = renderToStaticMarkup(<AgrochemicalLocationSelect location="COP" productLabel="ENM020" blockedReason="" onSave={onSave} />);
    expect(html).toContain('aria-label="Ubicación de ENM020"');
    expect(html).toContain('<option value="COP" selected="">COP</option>');
    expect(html).toContain('BODEGA AZUL');
    expect(html).toContain('PORTUGUESA');
    expect(html).not.toContain('disabled=""');
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each(['', 'Azul anterior'])('conserva una ubicación vacía o histórica sin corregirla automáticamente: %s', (location) => {
    const html = renderToStaticMarkup(<AgrochemicalLocationSelect location={location} productLabel="BIO006" blockedReason="" onSave={vi.fn()} />);
    expect(html).toContain(location || 'Sin ubicación');
    expect(html).toContain(`value="${location}" disabled="" selected=""`);
  });

  it('bloquea la edición cuando los datos vienen de caché o no hay conexión', () => {
    const html = renderToStaticMarkup(<AgrochemicalLocationSelect location="COP" productLabel="ENM020" blockedReason="Esperando sincronización" onSave={vi.fn()} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('title="Esperando sincronización"');
  });

  it('el filtro de columna solo toma la ubicación actual, no las opciones ni el estado de guardado', () => {
    const cell = <td data-filter-value="COP"><AgrochemicalLocationSelect location="COP" productLabel="ENM020" blockedReason="" onSave={vi.fn()} /></td>;
    expect(filterText(cell)).toBe('COP');
  });
});
