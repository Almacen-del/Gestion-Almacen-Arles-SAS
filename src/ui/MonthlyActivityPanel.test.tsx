// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MonthlyValuationSummary } from '../valuation/models';
import { buildMonthlyActivity } from '../valuation/monthlyActivity';
import MonthlyActivityPanel from './MonthlyActivityPanel';
const mocks = vi.hoisted(() => ({ load: vi.fn(), excel: vi.fn(), download: vi.fn() }));
vi.mock('../valuation/monthlyActivityStorage', () => ({ loadMonthlyActivity: mocks.load }));
vi.mock('../platform/monthlyActivityExcelExport', () => ({ generateMonthlyActivityExcel: mocks.excel, monthlyActivityExcelFilename: () => 'test.xlsx' }));
vi.mock('../platform/browserPlatform', () => ({ downloadExcelFile: mocks.download }));
vi.mock('./ColumnFilterTable', () => ({ default: ({ children }: { children: ReactNode }) => <table>{children}</table> }));
const source = { id: 'm1', module: 'Combustible', type: 'Salida', code: 'ACPM2', name: 'ACPM', reference: '', quantity: 10.9, unit: 'Galones', occurredAt: '2026-07-16 13:03', destinationLot: '24' };
const built = buildMonthlyActivity('2026-07', [], [source], new Date('2026-08-01T04:59:59Z'));
const saved = { ...built, rows: [{ ...built.rows[0], destinationLot: '4', expense: 132980, unitValue: 12000, issue: '' as const }] };
const summary = { period: '2026-07', createdBy: 'Test', createdAt: new Date('2026-08-01T04:59:59Z'), activity: { version: 1 } } as MonthlyValuationSummary;
const props = { view: 'expense' as const, summary, items: [], sources: [source], itemsReady: true, historyReady: true };
beforeEach(() => { mocks.load.mockReset().mockResolvedValue(saved); mocks.excel.mockReset().mockResolvedValue(new Uint8Array()); mocks.download.mockReset(); });
afterEach(cleanup);
describe('monthly activity screen and Excel consistency', () => {
  it('shows corrected lot 24 and passes the same frozen snapshot and trace to Excel', async () => {
    render(<MonthlyActivityPanel {...props} />);
    await screen.findByText('Ver 1 ajustes de destino de esta consulta');
    expect(screen.getAllByText('Lote 24').length).toBeGreaterThan(0);
    expect(screen.queryByText('Lote 4')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar informe completo' }));
    await waitFor(() => expect(mocks.excel).toHaveBeenCalledTimes(1));
    const payload = mocks.excel.mock.calls[0][0];
    expect(payload.snapshot.rows[0]).toEqual({ ...saved.rows[0], destinationLot: '24' });
    expect(payload.destinationCorrections[0]).toMatchObject({ movementId: 'm1', before: '4', after: '24' });
    expect(saved.rows[0].destinationLot).toBe('4');
  });
  it('warns on incomplete history, disables export, then updates the same screen when sources are confirmed', async () => {
    const view = render(<MonthlyActivityPanel {...props} historyReady={false} />);
    await screen.findByText(/falta confirmar el historial/);
    expect((screen.getByRole('button', { name: 'Preparando Excel...' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText('Lote 4').length).toBeGreaterThan(0);
    view.rerender(<MonthlyActivityPanel {...props} />);
    await screen.findByText('Ver 1 ajustes de destino de esta consulta');
    expect(screen.queryByText('Lote 4')).toBeNull(); expect(mocks.excel).not.toHaveBeenCalled();
  });
});
