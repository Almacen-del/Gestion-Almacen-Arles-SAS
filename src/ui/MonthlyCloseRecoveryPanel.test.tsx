// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonthlyValuationSummary } from '../valuation/models';
import MonthlyCloseRecoveryPanel from './MonthlyCloseRecoveryPanel';
const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), recover: vi.fn() }));
vi.mock('../valuation/monthlyValuation', () => ({ currentValuationPeriod: () => '2026-09', subscribeMonthlyValuationPeriod: mocks.subscribe }));
vi.mock('../valuation/monthlyCloseLease', async importOriginal => ({ ...await importOriginal<object>(), recoverAbandonedMonthlyClose: mocks.recover }));
const close = { period: '2026-09', status: 'guardando', attemptId: 'a1', lastProgressAt: new Date(Date.now() - 20 * 60_000) } as MonthlyValuationSummary;
let update: (summary: MonthlyValuationSummary | null) => void;
let metadata: (state: { fromCache: boolean; hasPendingWrites: boolean }) => void;
beforeEach(() => {
  mocks.recover.mockReset().mockResolvedValue(undefined);
  mocks.subscribe.mockImplementation((_period, onData, _error, onMetadata) => {
    update = onData; metadata = onMetadata;
    onData(close); onMetadata({ fromCache: false, hasPendingWrites: false }); return () => {};
  });
});
afterEach(cleanup);
async function openPanel(online = true) {
  const view = render(<MonthlyCloseRecoveryPanel userUid="admin" online={online} />);
  const details = view.container.querySelector('details')!;
  details.open = true; fireEvent(details, new Event('toggle'));
  await screen.findByLabelText('Confirmación de recuperación');
  return view;
}
describe('recovery UI safeguards', () => {
  it('requires a typed confirmation and sends the exact selected attempt, never auto-recovers', async () => {
    await openPanel();
    const button = screen.getByRole('button', { name: 'Liberar intento interrumpido' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); expect(mocks.recover).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirmación de recuperación'), { target: { value: 'RECUPERAR 2026-09' } });
    fireEvent.click(button);
    await waitFor(() => expect(mocks.recover).toHaveBeenCalledWith({ period: '2026-09', attemptId: 'a1', userUid: 'admin', confirmation: 'RECUPERAR 2026-09' }));
    await screen.findByText(/No se eliminaron sus datos/);
  });
  it.each(['offline', 'cache', 'pending'])('refuses a recovery with %s state', async mode => {
    await openPanel(mode !== 'offline');
    if (mode !== 'offline') act(() => metadata({ fromCache: mode === 'cache', hasPendingWrites: mode === 'pending' }));
    fireEvent.change(screen.getByLabelText('Confirmación de recuperación'), { target: { value: 'RECUPERAR 2026-09' } });
    expect((screen.getByRole('button', { name: 'Liberar intento interrumpido' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
  it.each(['completo', 'error', 'active', 'missing-date'])('stops recovery when live status changes to %s', async mode => {
    await openPanel();
    fireEvent.change(screen.getByLabelText('Confirmación de recuperación'), { target: { value: 'RECUPERAR 2026-09' } });
    act(() => update({ ...close, status: mode === 'completo' || mode === 'error' ? mode : 'guardando',
      lastProgressAt: mode === 'missing-date' ? null : mode === 'active' ? new Date() : close.lastProgressAt }));
    expect((screen.getByRole('button', { name: 'Liberar intento interrumpido' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows server refusal rather than claiming success', async () => {
    mocks.recover.mockRejectedValue(new Error('El cierre cambió.'));
    await openPanel(); fireEvent.change(screen.getByLabelText('Confirmación de recuperación'), { target: { value: 'RECUPERAR 2026-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Liberar intento interrumpido' }));
    await screen.findByText('El cierre cambió.');
  });
  it('clears typed approval when another attempt replaces the displayed one', async () => {
    await openPanel(); fireEvent.change(screen.getByLabelText('Confirmación de recuperación'), { target: { value: 'RECUPERAR 2026-09' } });
    act(() => update({ ...close, attemptId: 'a2' }));
    expect((screen.getByLabelText('Confirmación de recuperación') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Liberar intento interrumpido' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
