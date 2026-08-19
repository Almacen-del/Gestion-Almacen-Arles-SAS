import { describe, expect, it } from 'vitest';
import {
  OWNER_EMAIL,
  hasActiveUserStatus,
  isAuthorizedUserProfile,
} from './authorization';

describe('autorización del panel', () => {
  it('mantiene el acceso del propietario', () => {
    expect(isAuthorizedUserProfile(OWNER_EMAIL, null)).toBe(true);
  });

  it('exige estado activo y rol permitido', () => {
    expect(isAuthorizedUserProfile('almacen@arles.co', {
      activo: true,
      rol: 'almacenista',
    })).toBe(true);
    expect(isAuthorizedUserProfile('almacen@arles.co', {
      activo: true,
      rol: 'visitante',
    })).toBe(false);
    expect(isAuthorizedUserProfile('almacen@arles.co', {
      rol: 'almacenista',
    })).toBe(false);
  });

  it('bloquea cualquier marca explícita de desactivación', () => {
    expect(hasActiveUserStatus({ activo: false, estado: 'activo' })).toBe(false);
    expect(isAuthorizedUserProfile('almacen@arles.co', {
      activo: true,
      estado: 'suspendido',
      rol: 'admin',
    })).toBe(false);
  });
});
