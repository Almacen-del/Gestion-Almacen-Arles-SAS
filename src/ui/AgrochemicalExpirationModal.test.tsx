// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgrochemicalExpirationModal from './AgrochemicalExpirationModal';
import { readLotAttempt } from '../agrochemicalRegistration';
import type { AgrochemicalLot, AgrochemicalStockEntry } from '../agrochemicalLots';
const scope = 'demo:warehouse';
const entry: AgrochemicalStockEntry = { id: 'E1', productDocumentId: 'P1', code: 'FER159', productName: 'Firmeza', moduleName: 'Agroquimicos',
  quantity: 10, unit: 'GRAMO', dateLabel: '11/08/2026', dateKey: '2026-08-11', createdAtMs: 1, validationIssue: '' };
const lot: AgrochemicalLot = { id: 'C506__2026-05', productDocumentId: 'P1', lotNumber: 'C506', expirationDate: '2028-05',
  quantity: 50, initialQuantity: 50, receivedAt: '2026-08-11', productCode: 'FER159', productName: 'Firmeza', unit: 'GRAMO', location: 'COP', entryAssignments: [] };
const props = { registrationScope: scope, canRegister: true, products: [{ id: 'P1', code: 'FER159', name: 'Firmeza', stock: 100, unit: 'GRAMO', location: 'COP' }],
  lots: [lot], entries: [entry], loading: false, sourceError: '', onClose: vi.fn() };
function fillExisting(mode = 'add') {
  fireEvent.click(screen.getByRole('button', { name: 'Asignar lote' }));
  fireEvent.change(screen.getByLabelText('Reutilizar lote registrado', { exact: false }), { target: { value: lot.id } });
  if (mode) fireEvent.change(screen.getByLabelText('Tratamiento de esta entrada', { exact: false }), { target: { value: mode } });
}
beforeEach(() => {
  cleanup(); localStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_: string, task: () => Promise<void>) => task() } });
});
describe('formulario de asignación: interacción real del componente', () => {
  it('envía el ID seleccionado y suma la entrada nueva explícitamente', async () => {
    const register = vi.fn().mockResolvedValue(undefined); render(<AgrochemicalExpirationModal {...props} onRegister={register} />);
    fillExisting(); fireEvent.click(screen.getByRole('button', { name: 'Registrar lote' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toMatchObject({ existingLotId: lot.id, expirationDate: '2028-05', quantity: 10, sourceEntryId: 'E1', linkExistingLotWithoutStockIncrease: false });
    await waitFor(() => expect(readLotAttempt(localStorage, scope)).toBeNull());
  });
  it('vincula sin sumar solo cuando se elige explícitamente', async () => {
    const register = vi.fn().mockResolvedValue(undefined); render(<AgrochemicalExpirationModal {...props} onRegister={register} />);
    fillExisting('link'); fireEvent.click(screen.getByRole('button', { name: 'Registrar lote' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0].linkExistingLotWithoutStockIncrease).toBe(true);
  });
  it('no decide automáticamente que una entrada sea histórica', async () => {
    const register = vi.fn(); render(<AgrochemicalExpirationModal {...props} onRegister={register} />);
    fillExisting(''); fireEvent.click(screen.getByRole('button', { name: 'Registrar lote' }));
    expect(screen.getByText(/Indica si esta entrada es nueva/)).toBeDefined(); expect(register).not.toHaveBeenCalled();
  });
  it('usa el pendiente de entrada aunque el stock físico sea menor', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    render(<AgrochemicalExpirationModal {...props} products={[{ ...props.products[0], stock: 5 }]} onRegister={register} />);
    fillExisting(); fireEvent.click(screen.getByRole('button', { name: 'Registrar lote' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1)); expect(register.mock.calls[0][0].quantity).toBe(10);
  });
  it('un doble envío mientras guarda produce una única solicitud', async () => {
    let finish!: () => void;
    const register = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { container } = render(<AgrochemicalExpirationModal {...props} onRegister={register} />);
    fillExisting(); fireEvent.submit(container.querySelector('form')!); fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1)); finish();
    await waitFor(() => expect(readLotAttempt(localStorage, scope)).toBeNull());
  });
  it('recupera el mismo ID tras perder respuesta y reabrir con cola/stock ya actualizados', async () => {
    const register = vi.fn().mockRejectedValueOnce({ code: 'functions/unavailable' }).mockResolvedValue(undefined);
    const view = render(<AgrochemicalExpirationModal {...props} onRegister={register} />);
    fillExisting(); fireEvent.click(screen.getByRole('button', { name: 'Registrar lote' }));
    await waitFor(() => expect(screen.getByText('No se pudo registrar el lote.')).toBeDefined());
    const original = register.mock.calls[0][0]; view.unmount();
    render(<AgrochemicalExpirationModal {...props} entries={[]} loading={true} onRegister={register} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar / reintentar asignación pendiente' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2)); expect(register.mock.calls[1][0]).toEqual(original);
    await waitFor(() => expect(readLotAttempt(localStorage, scope)).toBeNull());
  });
  it('un rechazo atómico inicial libera el formulario para corregir los datos', async () => {
    const register = vi.fn().mockRejectedValue({ code: 'functions/failed-precondition', message: 'Cantidad pendiente insuficiente' });
    render(<AgrochemicalExpirationModal {...props} onRegister={register} />);
    fillExisting(); fireEvent.click(screen.getByRole('button', { name: 'Registrar lote' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1)); await waitFor(() => expect(readLotAttempt(localStorage, scope)).toBeNull());
  });
  it('no olvida un resultado incierto si se revocan permisos antes del reintento', async () => {
    const register = vi.fn().mockRejectedValueOnce({ code: 'functions/unavailable' }).mockRejectedValue({ code: 'functions/permission-denied' });
    render(<AgrochemicalExpirationModal {...props} onRegister={register} />);
    fillExisting(); fireEvent.click(screen.getByRole('button', { name: 'Registrar lote' }));
    await waitFor(() => expect(screen.getByText('No se pudo registrar el lote.')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar / reintentar asignación pendiente' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2)); expect(readLotAttempt(localStorage, scope)).not.toBeNull();
  });
});
