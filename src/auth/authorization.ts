import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';

export const OWNER_EMAIL = 'almacen@arlessas.com';

const ACTIVE_STATES = new Set(['activo', 'Activo', 'ACTIVO']);
const INACTIVE_STATES = new Set([
  'inactivo', 'Inactivo', 'INACTIVO',
  'desactivado', 'Desactivado', 'DESACTIVADO',
  'bloqueado', 'Bloqueado', 'BLOQUEADO',
  'suspendido', 'Suspendido', 'SUSPENDIDO',
]);
const ALLOWED_ROLES = new Set([
  'owner', 'Owner', 'OWNER',
  'admin', 'Admin', 'ADMIN',
  'administrador', 'Administrador', 'ADMINISTRADOR',
  'almacenista', 'Almacenista', 'ALMACENISTA',
  'operador', 'Operador', 'OPERADOR',
]);

export function hasActiveUserStatus(profile: Record<string, unknown>) {
  const state = typeof profile.estado === 'string' ? profile.estado : '';
  if (profile.activo === false || INACTIVE_STATES.has(state)) return false;
  return profile.activo === true || ACTIVE_STATES.has(state);
}

export function hasAllowedUserRole(profile: Record<string, unknown>) {
  const role = typeof profile.rol === 'string' ? profile.rol : '';
  const legacyRole = typeof profile.role === 'string' ? profile.role : '';
  return ALLOWED_ROLES.has(role)
    || ALLOWED_ROLES.has(legacyRole);
}

// UX mirror of canManageInventory in firestore.rules. The server is authoritative.
export function canManageInventoryProfile(email: string | null, profile: Record<string, unknown> | null) {
  if (email === OWNER_EMAIL) return true;
  if (!profile || !hasActiveUserStatus(profile)) return false;
  const managementRoles = new Set([
    'owner', 'Owner', 'OWNER', 'admin', 'Admin', 'ADMIN',
    'administrador', 'Administrador', 'ADMINISTRADOR',
    'almacenista', 'Almacenista', 'ALMACENISTA',
  ]);
  return managementRoles.has(String(profile.rol ?? '')) || managementRoles.has(String(profile.role ?? ''));
}

export function isAuthorizedUserProfile(
  email: string | null,
  profile: Record<string, unknown> | null,
) {
  if (email === OWNER_EMAIL) return true;
  return Boolean(profile && hasActiveUserStatus(profile) && hasAllowedUserRole(profile));
}

export async function verifyUserAuthorization(db: Firestore, user: User) {
  if (user.email === OWNER_EMAIL) return true;
  const snapshot = await getDocFromServer(doc(db, 'usuarios', user.uid));
  return isAuthorizedUserProfile(user.email, snapshot.exists() ? snapshot.data() : null);
}
