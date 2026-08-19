import { describe, expect, it } from 'vitest';
import {
  captureValuationBaseline,
  emptyValuationRevision,
  parseManualUnitValue,
  removeValuationBaseline,
  valuationRevisionFromData,
  valuationRevisionsMatch,
} from './manualValuation';

describe('valoración manual segura', () => {
  it('detecta cambios concurrentes de valor, autor o fecha', () => {
    const opened = valuationRevisionFromData(true, {
      valor_unitario: 1_500,
      actualizado_por_uid: 'equipo-a',
      actualizado_en: { seconds: 100, nanoseconds: 0 },
      origen_actualizacion: 'manual',
    });
    const changedByAnotherDevice = valuationRevisionFromData(true, {
      valor_unitario: 1_700,
      actualizado_por_uid: 'equipo-b',
      actualizado_en: { seconds: 101, nanoseconds: 0 },
      origen_actualizacion: 'manual',
    });

    expect(valuationRevisionsMatch(opened, changedByAnotherDevice)).toBe(false);
  });

  it('detecta una actualización aunque el valor vuelva al importe abierto', () => {
    const opened = valuationRevisionFromData(true, {
      valor_unitario: 1_500,
      actualizado_por_uid: 'equipo-a',
      actualizado_en: { seconds: 100, nanoseconds: 0 },
    });
    const changedAndRestored = valuationRevisionFromData(true, {
      valor_unitario: 1_500,
      actualizado_por_uid: 'equipo-b',
      actualizado_en: { seconds: 102, nanoseconds: 0 },
    });

    expect(valuationRevisionsMatch(opened, changedAndRestored)).toBe(false);
  });

  it('distingue crear un documento de editar uno existente', () => {
    expect(valuationRevisionsMatch(
      emptyValuationRevision(),
      valuationRevisionFromData(true, { valor_unitario: 0 }),
    )).toBe(false);
  });

  it('rechaza vacíos, negativos y números no finitos', () => {
    expect(parseManualUnitValue('')).toBeNull();
    expect(parseManualUnitValue('-1')).toBeNull();
    expect(parseManualUnitValue('Infinity')).toBeNull();
    expect(parseManualUnitValue('1250,5')).toBe(1250.5);
  });

  it('libera el baseline al abandonar sin cambios y captura la revisión más reciente al volver', () => {
    const valuationId = 'existencias__producto';
    const firstRevision = valuationRevisionFromData(true, {
      valor_unitario: 1_500,
      actualizado_por_uid: 'equipo-a',
      actualizado_en: { seconds: 100, nanoseconds: 0 },
    });
    const latestRevision = valuationRevisionFromData(true, {
      valor_unitario: 1_700,
      actualizado_por_uid: 'equipo-b',
      actualizado_en: { seconds: 101, nanoseconds: 0 },
    });

    const firstFocus = captureValuationBaseline({}, valuationId, firstRevision);
    const afterUnchangedBlur = removeValuationBaseline(firstFocus, valuationId);
    const secondFocus = captureValuationBaseline(afterUnchangedBlur, valuationId, latestRevision);

    expect(afterUnchangedBlur[valuationId]).toBeUndefined();
    expect(secondFocus[valuationId]).toEqual(latestRevision);
  });
});
