// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { colombiaDateTime } from '../backend/supabase/climate';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
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
it('previews out-of-range products before saving, and saves one idempotent reading', async () => {
  render(<AgrochemicalClimateModal onClose={vi.fn()} />);
  await screen.findByText('Nueva medición');
  fireEvent.change(screen.getByLabelText('Temperatura (°C)'), { target: { value: '33' } });
  fireEvent.change(screen.getByLabelText('Humedad relativa (%)'), { target: { value: '79' } });
  expect(screen.getByText('Temperatura superior a 32 °C')).toBeTruthy();
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockImplementation((name: string) => Promise.resolve(name === 'climate_web_record_reading' ? { data: null, error: { code: 'NETWORK' } } : { data: dashboard, error: null }));
  fireEvent.click(screen.getByText('Guardar medición'));
  await screen.findByRole('alert');
  const first = rpc.mock.calls.find(c => c[0] === 'climate_web_record_reading')![1];
  fireEvent.click(screen.getByText('Guardar medición'));
  await waitFor(() => expect(rpc.mock.calls.filter(c => c[0] === 'climate_web_record_reading')).toHaveLength(2));
  expect(rpc.mock.calls.filter(c => c[0] === 'climate_web_record_reading')[1][1].p_id).toBe(first.p_id);
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
