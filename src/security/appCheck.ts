import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

export type AppCheckInitialization = {
  appCheck: AppCheck | null;
  enabled: boolean;
};

export function initializeBrowserAppCheck(
  app: FirebaseApp,
  environment: ImportMetaEnv,
): AppCheckInitialization {
  const siteKey = environment.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim() ?? '';
  if (!siteKey) return { appCheck: null, enabled: false };

  return {
    appCheck: initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    }),
    enabled: true,
  };
}
