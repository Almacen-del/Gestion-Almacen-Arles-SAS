import { describe, expect, it } from 'vitest';
import {
  OWNER_EMAIL,
  hasActiveUserStatus,
  isAuthorizedUserProfile,
  canManageInventoryProfile,
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

describe('permisos de gestión de inventario', () => {
  it('conserva propietario y roles de gestión activos', () => {
    expect(canManageInventoryProfile(OWNER_EMAIL, null)).toBe(true);
    for (const rol of ['almacenista', 'Administrador', 'ADMIN', 'Owner']) {
      expect(canManageInventoryProfile('prueba@arlessas.com', { activo: true, rol })).toBe(true);
    }
    expect(canManageInventoryProfile('prueba@arlessas.com', { estado: 'Activo', role: 'almacenista' })).toBe(true);
  });
  it('no concede gestión a operadores, perfiles pendientes ni desactivados', () => {
    for (const profile of [null, { activo: true, rol: 'operador' }, { activo: false, rol: 'admin' },
      { activo: true, estado: 'suspendido', rol: 'admin' }, { rol: 'almacenista' }]) {
      expect(canManageInventoryProfile('prueba@arlessas.com', profile)).toBe(false);
    }
  });
});
