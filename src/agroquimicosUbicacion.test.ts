import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { locationSaveErrorMessage, saveAgrochemicalLocation } from './agroquimicosUbicacion';
import type { AgroquimicosUbicacion } from './agroquimicosCanonicos';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` })),
  get: vi.fn(),
  update: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({ doc: firestore.doc, runTransaction: firestore.runTransaction }));

const options = {
  db: {} as Firestore,
  productId: 'Q-ENM020-BODEGA-AZUL',
  expectedLocation: 'BODEGA AZUL',
  location: 'COP' as AgroquimicosUbicacion,
  online: true,
  sourceReady: true,
};

function product(data: Record<string, unknown>, exists = true) {
  firestore.get.mockResolvedValue({ exists: () => exists, data: () => data });
}

beforeEach(() => {
  vi.clearAllMocks();
  firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
    get: firestore.get, update: firestore.update,
  }));
  product({ modulo: 'Agroquímicos', ubicacion: 'BODEGA AZUL', codigo: 'ENM020', cantidad: 76059000 });
});

describe('ubicación de agroquímicos', () => {
  it('cambia solo la ubicación del documento exacto, conservando código, saldo e ID', async () => {
    await expect(saveAgrochemicalLocation(options)).resolves.toBe('COP');
    expect(firestore.doc).toHaveBeenCalledExactlyOnceWith(options.db, 'existencias', options.productId);
    expect(firestore.get).toHaveBeenCalledExactlyOnceWith({ path: `existencias/${options.productId}` });
    expect(firestore.update).toHaveBeenCalledExactlyOnceWith(
      { path: `existencias/${options.productId}` }, { ubicacion: 'COP' },
    );
  });

  it('no busca ni combina otra existencia con el mismo código en la ubicación destino', async () => {
    await saveAgrochemicalLocation({ ...options, productId: 'otra-existencia-ENM020' });
    expect(firestore.update).toHaveBeenCalledExactlyOnceWith(
      { path: 'existencias/otra-existencia-ENM020' }, { ubicacion: 'COP' },
    );
    expect(firestore.get).toHaveBeenCalledTimes(1);
  });

  it.each(['BODEGA AZUL', 'COP', 'PORTUGUESA'] as const)('acepta la ubicación %s para una existencia sin ubicación', async (location) => {
    product({ modulo: 'Agroquimicos' });
    await saveAgrochemicalLocation({ ...options, expectedLocation: '', location });
    expect(firestore.update).toHaveBeenCalledWith(expect.anything(), { ubicacion: location });
  });

  it.each([
    [{ online: false }, 'internet'],
    [{ sourceReady: false }, 'sincronice'],
    [{ productId: '' }, 'identificador'],
    [{ productId: 'foo/bar' }, 'identificador'],
    [{ location: 'Todos' as AgroquimicosUbicacion }, 'ubicación válida'],
  ])('rechaza datos no seguros antes de iniciar una transacción: %j', async (overrides, message) => {
    await expect(saveAgrochemicalLocation({ ...options, ...overrides })).rejects.toThrow(message);
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('no recrea un producto eliminado', async () => {
    product({}, false);
    await expect(saveAgrochemicalLocation(options)).rejects.toThrow('ya no existe');
    expect(firestore.update).not.toHaveBeenCalled();
  });

  it('no modifica un producto de otro módulo', async () => {
    product({ modulo: 'Consumibles', ubicacion: 'BODEGA AZUL' });
    await expect(saveAgrochemicalLocation(options)).rejects.toThrow('Solo se puede');
    expect(firestore.update).not.toHaveBeenCalled();
  });

  it('no sobrescribe la ubicación cambiada por otro equipo', async () => {
    product({ modulo: 'Agroquimicos', ubicacion: 'PORTUGUESA' });
    await expect(saveAgrochemicalLocation(options)).rejects.toThrow('otro equipo');
    expect(firestore.update).not.toHaveBeenCalled();
  });

  it('no vuelve a escribir cuando el destino ya está guardado', async () => {
    product({ modulo: 'Agroquimicos', ubicacion: 'COP' });
    await expect(saveAgrochemicalLocation(options)).resolves.toBe('COP');
    expect(firestore.update).not.toHaveBeenCalled();
  });

  it('propaga los fallos de Firestore sin indicar éxito', async () => {
    firestore.runTransaction.mockRejectedValueOnce({ code: 'permission-denied' });
    await expect(saveAgrochemicalLocation(options)).rejects.toEqual({ code: 'permission-denied' });
    expect(firestore.update).not.toHaveBeenCalled();
    expect(locationSaveErrorMessage({ code: 'permission-denied' })).toContain('permiso');
    expect(locationSaveErrorMessage({ code: 'unavailable' })).toContain('No se pudo confirmar');
  });
});
