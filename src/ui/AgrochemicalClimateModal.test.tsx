// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../backend/supabase/runtime', () => ({ webSupabaseClient: () => ({ rpc }) }));
import AgrochemicalClimateModal from './AgrochemicalClimateModal';
const reading = { id: 'r1', location: 'COP', temperature_c: 25.5, humidity_percent: 61,
  measured_at: '2026-09-24T13:00:00Z', responsible_name: 'Operador de prueba', notes: 'Lectura manual' };
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: [reading], error: null }); });
afterEach(cleanup);
it('shows confirmed measurements and filters at the server', async () => {
  render(<AgrochemicalClimateModal onClose={vi.fn()} />);
  await screen.findByText('25.5 °C');
  expect(screen.getByText('Responsable: Operador de prueba')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'COP' } });
  await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('climate_readings_page', { p_location: 'COP', p_before: null, p_limit: 500 }));
});
it('removes old measurements when refresh loses access', async () => {
  render(<AgrochemicalClimateModal onClose={vi.fn()} />);
  await screen.findByText('25.5 °C');
  rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  fireEvent.click(screen.getByText('Actualizar registros'));
  await screen.findByRole('alert');
  expect(screen.queryByText('25.5 °C')).toBeNull();
});
it('shows empty history and closes with Escape', async () => {
  rpc.mockResolvedValue({ data: [], error: null }); const close = vi.fn();
  render(<AgrochemicalClimateModal onClose={close} />);
  await screen.findByText('No hay mediciones registradas para esta ubicación.');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
});
