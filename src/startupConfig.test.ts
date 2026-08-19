import { describe, expect, it } from 'vitest';
import {
  FIREBASE_ENV_VARIABLES,
  FirebaseConfigurationError,
  requireFirebaseConfig,
  validateFirebaseEnvironment,
} from './startupConfig';

const validEnvironment = {
  VITE_FIREBASE_API_KEY: 'example-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'example-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'example.firebasestorage.app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
};

describe('configuración segura de Firebase', () => {
  it('informa únicamente los nombres de las variables ausentes', () => {
    const result = validateFirebaseEnvironment({
      ...validEnvironment,
      VITE_FIREBASE_API_KEY: '   ',
      VITE_FIREBASE_PROJECT_ID: undefined,
    });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Se esperaba una configuración incompleta.');
    expect(result.missingVariables).toEqual([
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_PROJECT_ID',
    ]);
    expect(JSON.stringify(result)).not.toContain('example.firebaseapp.com');
  });

  it('crea la configuración solo cuando todas las variables requeridas existen', () => {
    const config = requireFirebaseConfig(validEnvironment);

    expect(config.projectId).toBe('example-project');
    expect(Object.keys(config)).toHaveLength(FIREBASE_ENV_VARIABLES.length);
  });

  it('bloquea la inicialización si falta configuración', () => {
    expect(() => requireFirebaseConfig({})).toThrow(FirebaseConfigurationError);
  });
});
