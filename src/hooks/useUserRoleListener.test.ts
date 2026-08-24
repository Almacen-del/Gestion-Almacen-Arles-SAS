import { describe, expect, it } from 'vitest';
import { shouldForceLogoutFromUserSnapshot } from './useUserRoleListener';

describe('useUserRoleListener authorization snapshots', () => {
  const pendingProfile = {
    rol: 'pendiente',
    estado: 'pendiente',
    activo: false,
  };

  it('no cierra la sesión por un perfil pendiente leído desde caché', () => {
    expect(shouldForceLogoutFromUserSnapshot(pendingProfile, {
      fromCache: true,
      hasPendingWrites: false,
    })).toBe(false);
  });

  it('cierra la sesión cuando el servidor confirma que el perfil está inactivo', () => {
    expect(shouldForceLogoutFromUserSnapshot({
      rol: 'administrador',
      estado: 'inactivo',
      activo: false,
    }, {
      fromCache: false,
      hasPendingWrites: false,
    })).toBe(true);
  });

  it('mantiene la sesión cuando el servidor confirma un perfil activo', () => {
    expect(shouldForceLogoutFromUserSnapshot({
      rol: 'administrador',
      estado: 'activo',
      activo: true,
    }, {
      fromCache: false,
      hasPendingWrites: false,
    })).toBe(false);
  });
});
