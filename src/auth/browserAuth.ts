import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signOut,
  setPersistence,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { doc, setDoc, type Firestore, serverTimestamp } from 'firebase/firestore';

let persistencePromise: Promise<void> | null = null;

export const CORPORATE_EMAIL_DOMAIN = 'arlessas.com';

export function normalizeCorporateEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.endsWith(`@${CORPORATE_EMAIL_DOMAIN}`)) {
    throw new Error('AUTH_CORPORATE_EMAIL_REQUIRED');
  }
  return normalizedEmail;
}

export function configureBrowserAuthPersistence(auth: Auth) {
  if (!persistencePromise) {
    persistencePromise = setPersistence(auth, browserLocalPersistence).catch((error) => {
      persistencePromise = null;
      throw error;
    });
  }
  return persistencePromise;
}

export async function signInWithNormalizedEmail(auth: Auth, email: string, password: string) {
  if (!password) {
    throw new Error('AUTH_FIELDS_REQUIRED');
  }
  const normalizedEmail = normalizeCorporateEmail(email);
  await configureBrowserAuthPersistence(auth);
  await signInWithEmailAndPassword(auth, normalizedEmail, password);
}

export async function createCorporateAccount(auth: Auth, db: Firestore, email: string, password: string) {
  if (!password) {
    throw new Error('AUTH_FIELDS_REQUIRED');
  }
  const normalizedEmail = normalizeCorporateEmail(email);
  await configureBrowserAuthPersistence(auth);
  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  await setDoc(doc(db, 'usuarios', credential.user.uid), {
    email: normalizedEmail,
    rol: 'pendiente',
    activo: false,
    estado: 'pendiente',
    creadoEn: serverTimestamp(),
  });
  await signOut(auth);
  throw new Error('AUTH_REGISTRATION_PENDING');
}
