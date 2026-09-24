import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { requireFirebaseConfig } from './startupConfig';
import { initializeBrowserAppCheck } from './security/appCheck';

import { USE_SUPABASE } from './backend/selection';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { AppCheck } from 'firebase/app-check';

// Keep legacy imports compatible without initializing Firebase in the Supabase panel.
// Any missed legacy operation fails locally instead of contacting the old database.
function unavailable<T extends object>():T {
  return new Proxy({} as T,{get(){throw new Error('La conexión Firebase está desactivada.');}});
}
const legacy = USE_SUPABASE ? null : (()=>{
  const app=initializeApp(requireFirebaseConfig(import.meta.env));
  const check=initializeBrowserAppCheck(app,import.meta.env);
  return {app,check,auth:getAuth(app),db:initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})};
})();
export const firebaseApp=legacy?.app??unavailable<FirebaseApp>();
export const appCheck:AppCheck|null=legacy?.check.appCheck??null;
export const appCheckEnabled=legacy?.check.enabled??false;
export const firebaseProjectId=legacy?.app.options.projectId??'';
export const auth=legacy?.auth??unavailable<Auth>();
export const db=legacy?.db??unavailable<Firestore>();
