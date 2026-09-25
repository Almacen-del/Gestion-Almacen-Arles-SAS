// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { colombiaDateTime } from '../backend/supabase/climate';
const { rpc, downloadClimateMonth } = vi.hoisted(() => ({ rpc: vi.fn(), downloadClimateMonth: vi.fn() }));
vi.mock('../platform/climateTemplateExport', () => ({ downloadClimateMonth }));
vi.mock('../backend/supabase/runtime', () => ({ webSupabaseClient: () => ({ rpc }) }));
import AgrochemicalClimateModal from './AgrochemicalClimateModal';
const criteria = { version: 'v1', source: 'fichas.pdf', reference: null, rules: [{ code: 'BIO006', name: 'NEMACYL', t_min: null, t_max: 32, h_max: 78, page: 1, details: 'Ficha validada' }] };
const reading = { id: 'r1', period: 'AM', reading_date: colombiaDateTime().slice(0, 10), temperature_c: 25.5, humidity_percent: 61, measured_at: new Date().toISOString(), responsible_name: 'Operador de prueba', notes: 'Lectura manual', criteria_version: 'v1' };
const dashboard = { criteria: [criteria], current_version: 'v1', readings: [reading], can_record: true };
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: dashboard, error: null }); });
afterEach(cleanup);
it('loads date ranges and shows real history without legacy location arguments', async () => {
  render(<AgrochemicalClimateModal onClose={vi.fn()} />);
  await screen.findByText('Operador de prueba');
  expect(rpc.mock.calls[0][0]).toBe('climate_dashboard');
  fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: 'month' } });
  fireEvent.change(screen.getByLabelText('Fecha del periodo'), { target: { value: '2024-02-15' } });
  await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('climate_dashboard', { p_from: '2024-02-01', p_to: '2024-02-29' }));
  expect(screen.queryByText('Operador de prueba')).toBeNull();
});
it('shows independent temperature and humidity results without web capture controls', async () => {
  rpc.mockResolvedValue({ data: { ...dashboard, readings: [{ ...reading, temperature_c: 26, humidity_percent: 95 }] }, error: null });
  render(<AgrochemicalClimateModal onClose={vi.fn()} />);
  await screen.findByText('Operador de prueba');
  expect(screen.queryByText('Nueva medición')).toBeNull();
  expect(screen.queryByText('Guardar medición')).toBeNull();
  const temperature = screen.getByRole('region', { name: 'Evaluación de temperatura' });
  const humidity = screen.getByRole('region', { name: 'Evaluación de humedad' });
  expect(within(temperature).getAllByText('Dentro de límites de la ficha')).toHaveLength(2);
  expect(within(temperature).queryByText('Humedad superior a 78 %')).toBeNull();
  expect(within(humidity).getByText('Humedad superior a 78 %')).toBeTruthy();
  expect(within(screen.getByRole('region', {name:'Historial de mediciones'})).getByRole('list')).toBeTruthy();
  expect(rpc.mock.calls.every(c => c[0] === 'climate_dashboard')).toBe(true);
});
it('preserves history after transient failure but removes it after permission denial', async () => {
  render(<AgrochemicalClimateModal onClose={vi.fn()} />); await screen.findByText('Operador de prueba');
  rpc.mockResolvedValue({ data: null, error: { code: 'NETWORK' } });
  fireEvent.click(screen.getByText('Actualizar registros')); await screen.findByRole('alert');
  expect(screen.getByText('Operador de prueba')).toBeTruthy();
  rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  fireEvent.click(screen.getByText('Actualizar registros'));
  await waitFor(() => expect(screen.queryByText('Operador de prueba')).toBeNull());
});
it('readers cannot submit and missing readings are not plotted as zero', async () => {
  rpc.mockResolvedValue({ data: { ...dashboard, can_record: false, readings: [] }, error: null });
  const close = vi.fn(); render(<AgrochemicalClimateModal onClose={close} />);
  await screen.findByText('No hay mediciones registradas en este periodo.');
  expect(screen.queryByText('Guardar medición')).toBeNull();
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
});

it('queries one day but exports the entire selected month independently of the product filter', async () => {
  render(<AgrochemicalClimateModal onClose={vi.fn()} />);
  await screen.findByText('Operador de prueba');
  fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: 'day' } });
  fireEvent.change(screen.getByLabelText('Fecha del periodo'), { target: { value: '2024-02-15' } });
  fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'BIO006' } });
  await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('climate_dashboard', { p_from: '2024-02-15', p_to: '2024-02-15' }));
  await waitFor(() => expect(screen.getByText('Exportar historial mensual').hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByText('Exportar historial mensual'));
  await waitFor(() => expect(downloadClimateMonth).toHaveBeenCalledWith('2024-02', dashboard.readings));
  expect(rpc).toHaveBeenLastCalledWith('climate_dashboard', { p_from: '2024-02-01', p_to: '2024-02-29' });
});

it('shows reference limits for all products in every period and filters only the history list', async()=>{
 const ref={t_min:15,t_max:30,h_max:65,note:'Referencia interna',sources:[]};
 rpc.mockResolvedValue({data:{...dashboard,criteria:[{...criteria,reference:ref}]},error:null});
 render(<AgrochemicalClimateModal onClose={vi.fn()}/>);
 await screen.findByText('Operador de prueba');
 for(const mode of ['day','week','month']) {
   fireEvent.change(screen.getByLabelText('Periodo'),{target:{value:mode}});
   await waitFor(()=>expect(screen.getByText('Mín. 15 ref.')).toBeTruthy());
   expect(screen.getByText('Máx. 30 ref.')).toBeTruthy();
   expect(screen.getByText('< 65 % ref.')).toBeTruthy();
 }
 const history=screen.getByRole('region',{name:'Historial de mediciones'});
 fireEvent.input(screen.getByLabelText('Historial desde'),{target:{value:'2099-01-01'}});
 expect(within(history).queryByText('Operador de prueba')).toBeNull();
 expect(screen.getByRole('img',{name:'Temperatura (°C): 1 mediciones. Valores exactos en el historial.'})).toBeTruthy();
 fireEvent.input(screen.getByLabelText('Historial hasta'),{target:{value:'2000-01-01'}});
 expect(screen.getByRole('alert').textContent).toContain('fecha inicial');
 fireEvent.click(screen.getByText('Limpiar fechas'));
 expect(within(history).getByText('Operador de prueba')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Producto'),{target:{value:'BIO006'}});
 expect(screen.getByText('Máx. 32')).toBeTruthy();
 expect(screen.queryByText('Máx. 30 ref.')).toBeNull();
});
