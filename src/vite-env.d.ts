/// <reference types="vite/client" />
declare const __APP_RELEASE__: { id: string; revision: string; builtAt: string };

interface ImportMetaEnv {
  readonly VITE_FIREBASE_APPCHECK_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
