import type { CurrentValuationRow } from './models';
import {
  CLOSE_REQUIRED_SOURCE_KEYS,
  FIRESTORE_SOURCE_LABELS,
  isServerSourceReady,
  type FirestoreSourceState,
  type FirestoreSourceStates,
} from './firestoreSync';

export const BOGOTA_TIME_ZONE = 'America/Bogota';

export type BogotaDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type CloseDocumentStatus = 'guardando' | 'completo' | 'error' | null;

export type MonthlyCloseEligibilityInput = {
  period: string;
  now: Date;
  online: boolean;
  sources: FirestoreSourceStates;
  closesSource: FirestoreSourceState;
  rows: CurrentValuationRow[];
  pendingEntryCount: number;
  inconsistentEntryCount: number;
  existingCloseStatus: CloseDocumentStatus;
  existingCloseCreatorUid: string;
  userUid: string;
};

export type MonthlyCloseEligibility = {
  eligible: boolean;
  reasons: string[];
  requiresEarlyConfirmation: boolean;
  confirmationText: string;
  currentPeriod: string;
};

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return Number(parts.find((part) => part.type === type)?.value ?? 0);
}

export function bogotaDateParts(date = new Date()): BogotaDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return {
    year: numericPart(parts, 'year'),
    month: numericPart(parts, 'month'),
    day: numericPart(parts, 'day'),
    hour: numericPart(parts, 'hour'),
    minute: numericPart(parts, 'minute'),
    second: numericPart(parts, 'second'),
  };
}

export function currentBogotaPeriod(date = new Date()) {
  const parts = bogotaDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

export function isLastBogotaDayOfMonth(date = new Date()) {
  const parts = bogotaDateParts(date);
  const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return parts.day === lastDay;
}

export function formatBogotaDateTime(date: Date) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TIME_ZONE,
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date);
}

export function evaluateMonthlyCloseEligibility({
  period,
  now,
  online,
  sources,
  closesSource,
  rows,
  pendingEntryCount,
  inconsistentEntryCount,
  existingCloseStatus,
  existingCloseCreatorUid,
  userUid,
}: MonthlyCloseEligibilityInput): MonthlyCloseEligibility {
  const reasons: string[] = [];
  const currentPeriod = currentBogotaPeriod(now);

  if (!online) reasons.push('No hay conexión con Firestore.');

  CLOSE_REQUIRED_SOURCE_KEYS.forEach((key) => {
    const state = sources[key];
    const label = FIRESTORE_SOURCE_LABELS[key];
    if (state.error) reasons.push(`${label} tiene un error de sincronización.`);
    else if (!state.received) reasons.push(`${label} no ha terminado de cargar.`);
    else if (state.fromCache) reasons.push(`${label} todavía usa datos de caché.`);
    else if (state.hasPendingWrites) reasons.push(`${label} tiene escrituras pendientes.`);
  });

  if (closesSource.error) reasons.push('No se pudo verificar el estado de los cierres mensuales.');
  else if (!closesSource.received) reasons.push('Los cierres mensuales no han terminado de cargar.');
  else if (closesSource.fromCache) reasons.push('El estado de los cierres mensuales proviene de caché.');
  else if (closesSource.hasPendingWrites) reasons.push('El cierre mensual tiene escrituras pendientes.');

  if (period !== currentPeriod) {
    reasons.push('Solo se puede cerrar el mes actual de America/Bogota.');
  }
  if (pendingEntryCount > 0) {
    reasons.push(`Hay ${pendingEntryCount} entrada(s) de stock pendientes de valorar.`);
  }
  if (inconsistentEntryCount > 0) {
    reasons.push(`Hay ${inconsistentEntryCount} entrada(s) de stock inconsistentes.`);
  }

  const invalidRows = rows.filter((row) => (
    !Number.isFinite(row.quantity)
    || row.quantity < 0
    || !Number.isFinite(row.unitValue)
    || row.unitValue < 0
    || !Number.isFinite(row.totalValue)
    || row.totalValue < 0
  ));
  if (invalidRows.length > 0) {
    reasons.push(`Hay ${invalidRows.length} producto(s) con datos de valoración inválidos.`);
  }

  const positiveStockWithoutValue = rows.filter((row) => row.quantity > 0 && row.unitValue <= 0);
  if (positiveStockWithoutValue.length > 0) {
    reasons.push(`Hay ${positiveStockWithoutValue.length} producto(s) con cantidad positiva y sin valor unitario.`);
  }
  if (rows.length === 0) reasons.push('No hay productos para guardar en el corte.');

  if (existingCloseStatus === 'completo') reasons.push('Ya existe un cierre completo para este mes.');
  if (existingCloseStatus === 'guardando') reasons.push('Ya existe un cierre en proceso para este mes.');
  if (
    existingCloseStatus === 'error'
    && existingCloseCreatorUid
    && existingCloseCreatorUid !== userUid
  ) {
    reasons.push('Solo el creador puede reintentar el cierre fallido de este mes.');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    requiresEarlyConfirmation: period === currentPeriod && !isLastBogotaDayOfMonth(now),
    confirmationText: `CERRAR ${currentPeriod}`,
    currentPeriod,
  };
}

export function isEarlyCloseConfirmationValid(typed: string, expected: string) {
  return typed.trim() === expected;
}

export function assertCurrentBogotaPeriod(period: string, now = new Date()) {
  const currentPeriod = currentBogotaPeriod(now);
  if (period !== currentPeriod) {
    throw new Error(`El periodo ${period} no es el mes actual ${currentPeriod} en America/Bogota.`);
  }
}

export function allCloseSourcesReady(
  sources: FirestoreSourceStates,
  closesSource: FirestoreSourceState,
) {
  return CLOSE_REQUIRED_SOURCE_KEYS.every((key) => isServerSourceReady(sources[key]))
    && isServerSourceReady(closesSource);
}
