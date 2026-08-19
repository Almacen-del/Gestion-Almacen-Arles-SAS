export const FIREBASE_ENV_VARIABLES = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const;

export type FirebaseEnvironmentVariable = typeof FIREBASE_ENV_VARIABLES[number];

export type ValidatedFirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
};

function normalizedEnvironmentValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateFirebaseEnvironment(environment: object) {
  const valuesByName = environment as Record<string, unknown>;
  const values = Object.fromEntries(FIREBASE_ENV_VARIABLES.map((variable) => (
    [variable, normalizedEnvironmentValue(valuesByName[variable])]
  ))) as Record<FirebaseEnvironmentVariable, string>;
  const missingVariables = FIREBASE_ENV_VARIABLES.filter((variable) => !values[variable]);

  if (missingVariables.length > 0) {
    return { valid: false as const, missingVariables };
  }

  return {
    valid: true as const,
    missingVariables: [] as FirebaseEnvironmentVariable[],
    config: {
      apiKey: values.VITE_FIREBASE_API_KEY,
      authDomain: values.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: values.VITE_FIREBASE_PROJECT_ID,
      storageBucket: values.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: values.VITE_FIREBASE_MESSAGING_SENDER_ID,
    } satisfies ValidatedFirebaseConfig,
  };
}

export class FirebaseConfigurationError extends Error {
  readonly missingVariables: FirebaseEnvironmentVariable[];

  constructor(missingVariables: FirebaseEnvironmentVariable[]) {
    super('La configuración de Firebase está incompleta.');
    this.name = 'FirebaseConfigurationError';
    this.missingVariables = [...missingVariables];
  }
}

export function requireFirebaseConfig(environment: object) {
  const result = validateFirebaseEnvironment(environment);
  if (!result.valid) throw new FirebaseConfigurationError(result.missingVariables);
  return result.config;
}
