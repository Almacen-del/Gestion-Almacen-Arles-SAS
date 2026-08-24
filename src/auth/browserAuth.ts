import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
  setPersistence,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { doc, getDocFromServer, setDoc, type Firestore, serverTimestamp } from 'firebase/firestore';

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

function pendingProfile(email: string, name = '', jobTitle = '') {
  return {
    email,
    nombre: name,
    nombres: name,
    cargo: jobTitle,
    rol: 'pendiente',
    activo: false,
    estado: 'pendiente',
    creadoEn: serverTimestamp(),
  };
}

export function isPendingUserProfile(profile: Record<string, unknown>) {
  return profile.rol === 'pendiente' || profile.estado === 'pendiente';
}

export async function signInWithNormalizedEmail(auth: Auth, db: Firestore, email: string, password: string) {
  if (!password) {
    throw new Error('AUTH_FIELDS_REQUIRED');
  }
  const normalizedEmail = normalizeCorporateEmail(email);
  await configureBrowserAuthPersistence(auth);
  const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
  const profileRef = doc(db, 'usuarios', credential.user.uid);
  const profileSnapshot = await getDocFromServer(profileRef);
  if (!profileSnapshot.exists()) {
    await setDoc(profileRef, pendingProfile(normalizedEmail));
    await signOut(auth);
    throw new Error('AUTH_REGISTRATION_PENDING');
  }
  if (isPendingUserProfile(profileSnapshot.data())) {
    await signOut(auth);
    throw new Error('AUTH_REGISTRATION_PENDING');
  }
}

export async function createCorporateAccount(
  auth: Auth,
  db: Firestore,
  email: string,
  password: string,
  name: string,
  jobTitle: string,
) {
  if (!password) {
    throw new Error('AUTH_FIELDS_REQUIRED');
  }
  const normalizedName = name.trim();
  const normalizedJobTitle = jobTitle.trim();
  if (!normalizedName || !normalizedJobTitle) {
    throw new Error('AUTH_REGISTRATION_DETAILS_REQUIRED');
  }
  const normalizedEmail = normalizeCorporateEmail(email);
  await configureBrowserAuthPersistence(auth);
  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  try {
    await setDoc(doc(db, 'usuarios', credential.user.uid), pendingProfile(
      normalizedEmail,
      normalizedName,
      normalizedJobTitle,
    ));
  } catch (profileError) {
    try {
      await deleteUser(credential.user);
    } catch {
      // El inicio de sesión posterior repara cualquier cuenta huérfana que no pudiera revertirse.
    }
    await signOut(auth).catch(() => undefined);
    throw new Error('AUTH_REGISTRATION_PROFILE_FAILED', { cause: profileError });
  }
  await signOut(auth);
  throw new Error('AUTH_REGISTRATION_PENDING');
}
