import { describe, expect, it } from 'vitest';
import {
  CLOSE_REQUIRED_SOURCE_KEYS,
  createInitialFirestoreSourceStates,
  isServerSourceReady,
  PANEL_REQUIRED_SOURCE_KEYS,
  updateSourceFromSnapshot,
  updateSourceWithError,
} from './firestoreSync';

describe('estado independiente de listeners Firestore', () => {
  it('un listener exitoso no borra el error de otra fuente', () => {
    const failed = updateSourceWithError(
      createInitialFirestoreSourceStates(),
      'tools',
      'permission-denied',
    );
    const updated = updateSourceFromSnapshot(failed, 'inventory', {
      fromCache: false,
      hasPendingWrites: false,
    });
    expect(updated.tools.error).toBe('permission-denied');
    expect(isServerSourceReady(updated.inventory)).toBe(true);
    expect(isServerSourceReady(updated.tools)).toBe(false);
  });

  it('no considera lista una fuente con caché o escrituras pendientes', () => {
    const cached = updateSourceFromSnapshot(createInitialFirestoreSourceStates(), 'aseo', {
      fromCache: true,
      hasPendingWrites: false,
    });
    const pending = updateSourceFromSnapshot(cached, 'valuations', {
      fromCache: false,
      hasPendingWrites: true,
    });
    expect(isServerSourceReady(pending.aseo)).toBe(false);
    expect(isServerSourceReady(pending.valuations)).toBe(false);
  });

  it('mantiene herramientas en el panel, pero no las exige para cerrar la valoración', () => {
    expect(PANEL_REQUIRED_SOURCE_KEYS).toContain('tools');
    expect(CLOSE_REQUIRED_SOURCE_KEYS).not.toContain('tools');
  });
});
