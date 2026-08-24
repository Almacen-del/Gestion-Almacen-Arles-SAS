import { describe, expect, it } from 'vitest';
import { isPendingUserProfile, normalizeCorporateEmail } from './browserAuth';

describe('normalizeCorporateEmail', () => {
  it('normalizes valid corporate emails', () => {
    expect(normalizeCorporateEmail('  Usuario@ARLESSAS.COM ')).toBe('usuario@arlessas.com');
  });

  it('rejects personal email domains', () => {
    expect(() => normalizeCorporateEmail('usuario@gmail.com')).toThrow('AUTH_CORPORATE_EMAIL_REQUIRED');
  });

  it('rejects empty emails', () => {
    expect(() => normalizeCorporateEmail('')).toThrow('AUTH_CORPORATE_EMAIL_REQUIRED');
  });

  it('rejects lookalike domains', () => {
    expect(() => normalizeCorporateEmail('usuario@arlessas.com.evil.test')).toThrow('AUTH_CORPORATE_EMAIL_REQUIRED');
  });

  it('identifica perfiles que todavía esperan aprobación', () => {
    expect(isPendingUserProfile({ rol: 'pendiente', estado: 'pendiente' })).toBe(true);
    expect(isPendingUserProfile({ rol: 'operador', estado: 'activo' })).toBe(false);
  });
});
