import { describe, expect, it } from 'vitest';
import {
  beginTallerStatusUpdate,
  createInitialTallerStatusState,
  effectiveTallerStatus,
  isTallerStatusBusy,
  markTallerStatusWriteAccepted,
  reconcileTallerStatusSnapshot,
  rollbackTallerStatusUpdate,
  sortTallerInventory,
} from './tallerStatus';

describe('estado optimista y orden de Taller', () => {
  it('ordena de forma estable sin mutar el arreglo original', () => {
    const items = [
      { id: 'b', codigo: '20', descripcion: 'B', estado: 'Bueno' },
      { id: 'a', codigo: '10', descripcion: 'A', estado: 'Mantenimiento' },
      { id: 'c', codigo: '10', descripcion: 'C', estado: 'Mantenimiento' },
    ];
    const original = [...items];

    const sorted = sortTallerInventory(items, 'maintenance-first', (item) => item.estado);

    expect(sorted.map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(items).toEqual(original);
  });

  it('bloquea duplicados y elimina el optimismo cuando el snapshot confirma', () => {
    const initial = createInitialTallerStatusState();
    const pending = beginTallerStatusUpdate(initial, 'herramienta-1', 'Mantenimiento');
    const duplicate = beginTallerStatusUpdate(pending, 'herramienta-1', 'Bueno');
    const accepted = markTallerStatusWriteAccepted(duplicate, 'herramienta-1');
    const localSnapshot = reconcileTallerStatusSnapshot(
      accepted,
      { 'herramienta-1': 'Mantenimiento' },
      false,
    );
    const confirmed = reconcileTallerStatusSnapshot(
      localSnapshot,
      { 'herramienta-1': 'Mantenimiento' },
      true,
    );

    expect(duplicate).toBe(pending);
    expect(isTallerStatusBusy(accepted, 'herramienta-1')).toBe(true);
    expect(localSnapshot.overrides['herramienta-1']).toBe('Mantenimiento');
    expect(confirmed.overrides['herramienta-1']).toBeUndefined();
    expect(isTallerStatusBusy(confirmed, 'herramienta-1')).toBe(false);
  });

  it('revierte el estado optimista cuando Firestore falla', () => {
    const initial = createInitialTallerStatusState();
    const pending = beginTallerStatusUpdate(initial, 'herramienta-1', 'Mantenimiento');
    const rolledBack = rollbackTallerStatusUpdate(
      pending,
      'herramienta-1',
      'No se pudo guardar el estado. Intenta nuevamente.',
    );

    expect(effectiveTallerStatus(rolledBack, 'herramienta-1', 'Bueno')).toBe('Bueno');
    expect(rolledBack.pending['herramienta-1']).toBeUndefined();
    expect(rolledBack.errors['herramienta-1']).toContain('No se pudo guardar');
  });
});
