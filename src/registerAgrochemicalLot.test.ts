import { describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), functions: vi.fn(() => 'function-instance'), callable: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: mocks.functions, httpsCallable: mocks.callable }));
import { registerAgrochemicalLotOnServer } from './registerAgrochemicalLot';
const app = {} as FirebaseApp;
const request = { operationId: 'operacion-00000001', productDocumentId: 'P1', existingLotId: 'C506__2026-05', lotNumber: 'C506',
  expirationDate: '2028-05', quantity: 10, receivedAt: '2026-08-11', linkExistingLotWithoutStockIncrease: false };
describe('cliente de asignación segura', () => {
  it('llama la función específica con ID real y comprobante, sin escribir directamente', async () => {
    mocks.callable.mockReturnValue(mocks.invoke); mocks.invoke.mockResolvedValue({ data: { operationId: request.operationId, productDocumentId: 'P1' } });
    await registerAgrochemicalLotOnServer(app, request);
    expect(mocks.functions).toHaveBeenCalledWith(app, 'us-central1');
    expect(mocks.callable).toHaveBeenCalledWith('function-instance', 'registrarLoteAgroquimico', { timeout: 70_000 });
    expect(mocks.invoke).toHaveBeenCalledWith(request);
  });
  it('no confirma una respuesta ajena', async () => {
    mocks.callable.mockReturnValue(mocks.invoke); mocks.invoke.mockResolvedValue({ data: { operationId: 'otra', productDocumentId: 'P1' } });
    await expect(registerAgrochemicalLotOnServer(app, request)).rejects.toThrow('comprobante');
  });
  it('conserva el código de rechazo; no usa una ruta antigua si falta la función', async () => {
    mocks.callable.mockReturnValue(mocks.invoke); const error = { code: 'functions/not-found' }; mocks.invoke.mockRejectedValue(error);
    await expect(registerAgrochemicalLotOnServer(app, request)).rejects.toBe(error);
  });
});
