import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { requireFirebaseConfig } from './startupConfig';
import { initializeBrowserAppCheck } from './security/appCheck';

const firebaseConfig = requireFirebaseConfig(import.meta.env);

export const firebaseApp = initializeApp(firebaseConfig);
export const { appCheck, enabled: appCheckEnabled } = initializeBrowserAppCheck(firebaseApp, import.meta.env);
export const firebaseProjectId = firebaseApp.options.projectId ?? '';
export const auth = getAuth(firebaseApp);
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
