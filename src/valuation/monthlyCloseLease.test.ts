import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { assertCloseAttempt, closeLastProgress, isCloseLeaseExpired, MONTHLY_CLOSE_LEASE_MS } from './monthlyCloseLease';
const now = new Date('2026-09-06T12:00:00Z');
describe('monthly close lease', () => {
  it('expires exactly at 15 minutes, never before, and rejects unknown time', () => {
    expect(isCloseLeaseExpired(new Date(now.getTime() - MONTHLY_CLOSE_LEASE_MS), now)).toBe(true);
    expect(isCloseLeaseExpired(new Date(now.getTime() - MONTHLY_CLOSE_LEASE_MS + 1), now)).toBe(false);
    expect(isCloseLeaseExpired(null, now)).toBe(false);
    expect(isCloseLeaseExpired(new Date(NaN), now)).toBe(false);
    expect(isCloseLeaseExpired(new Date(now.getTime() + 1), now)).toBe(false);
  });
  it('uses server pulse for protocol 2 and only the server date for legacy closes', () => {
    const time = Timestamp.fromDate(now);
    expect(closeLastProgress({ protocolo_cierre: 2, pulso: time })?.getTime()).toBe(now.getTime());
    expect(closeLastProgress({ fecha: time })?.getTime()).toBe(now.getTime());
    expect(closeLastProgress({ protocolo_cierre: 2, fecha: time })).toBeNull();
    expect(closeLastProgress({ fecha: now.toISOString() })).toBeNull();
  });
  it.each([undefined, { estado: 'completo', intento_id: 'a' }, { estado: 'error', intento_id: 'a' },
    { estado: 'guardando', intento_id: 'b', protocolo_cierre: 2 }, { estado: 'guardando', intento_id: 'a' }])('fences invalid or superseded writers %#', data => {
    expect(() => assertCloseAttempt(data, 'a')).toThrow();
  });
  it('accepts only the current protocol and attempt', () => {
    expect(() => assertCloseAttempt({ estado: 'guardando', intento_id: 'a', protocolo_cierre: 2 }, 'a')).not.toThrow();
  });
});
