/**
 * Hook para monitorear cambios de rol del usuario en tiempo real
 * Si el rol es removido o el usuario es desactivado, hace logout automático
 */

import { useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { signOut, User } from 'firebase/auth';
import { db, auth } from '../firebase';
import { Logger } from '../utils/logger';

interface UserProfile {
  activo?: boolean;
  estado?: string;
  rol?: string;
  role?: string;
}

interface SnapshotMetadataLike {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

const INACTIVE_STATES = ['inactivo', 'desactivado', 'bloqueado', 'suspendido'];

/**
 * Hook que monitorea cambios de rol/estado del usuario
 * Hace logout automático si:
 * - El usuario es desactivado
 * - El rol es removido
 * - El estado cambia a inactivo/bloqueado
 */
export function useUserRoleListener(user: User | null | undefined, onUnauthorized?: () => void) {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const logoutInProgressRef = useRef(false);

  useEffect(() => {
    if (!user?.uid) return;

    try {
      const userDocRef = doc(db, 'usuarios', user.uid);

      // Escuchar cambios en el documento del usuario
      unsubscribeRef.current = onSnapshot(
        userDocRef,
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!snapshot.exists()) {
            Logger.warn('Documento de usuario no encontrado', {
              component: 'useUserRoleListener',
              userId: user.uid,
            });
            return;
          }

          const profile = snapshot.data() as UserProfile;

          // Una lectura inicial puede traer desde caché el perfil pendiente que
          // existía antes de que un administrador activara la cuenta. Solo el
          // estado confirmado por el servidor puede forzar el cierre de sesión.
          if (shouldForceLogoutFromUserSnapshot(profile, snapshot.metadata)) {
            handleUserUnauthorized(user.uid);
          }
        },
        (error) => {
          Logger.error(error, {
            component: 'useUserRoleListener',
            action: 'onSnapshot_error',
            userId: user.uid,
          });
        }
      );
    } catch (error) {
      Logger.error(error instanceof Error ? error : new Error(String(error)), {
        component: 'useUserRoleListener',
        action: 'setup_failed',
        userId: user?.uid,
      });
    }

    // Cleanup
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [user?.uid, onUnauthorized]);

  const handleUserUnauthorized = async (userId: string) => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;

    Logger.auth('unauthorized_detected', userId, false, {
      reason: 'role_or_status_changed',
    });

    try {
      await signOut(auth);
      Logger.auth('force_logout', userId, true, {
        reason: 'role_or_status_changed',
      });

      if (onUnauthorized) {
        onUnauthorized();
      }
    } catch (error) {
      Logger.error(error instanceof Error ? error : new Error(String(error)), {
        component: 'useUserRoleListener',
        action: 'logout_failed',
        userId,
      });
    } finally {
      logoutInProgressRef.current = false;
    }
  };
}

/**
 * Verificar si el usuario sigue siendo activo
 */
export function shouldForceLogoutFromUserSnapshot(
  profile: UserProfile,
  metadata: SnapshotMetadataLike,
): boolean {
  if (metadata.fromCache || metadata.hasPendingWrites) return false;
  return !isUserActive(profile);
}

export function isUserActive(profile: UserProfile): boolean {
  const allowedRoles = [
    'owner',
    'Owner',
    'OWNER',
    'admin',
    'Admin',
    'ADMIN',
    'administrador',
    'Administrador',
    'ADMINISTRADOR',
    'almacenista',
    'Almacenista',
    'ALMACENISTA',
    'operador',
    'Operador',
    'OPERADOR',
  ];

  // Verificar activo/estado
  const hasActivo = 'activo' in profile;
  const hasEstado = 'estado' in profile;

  const isActive =
    (!hasActivo || profile.activo !== false) &&
    (!hasEstado || !INACTIVE_STATES.includes((profile.estado || '').toLowerCase()));

  if (!isActive) {
    return false;
  }

  // Verificar rol
  const hasValidRole =
    ('rol' in profile && allowedRoles.includes(profile.rol as string)) ||
    ('role' in profile && allowedRoles.includes(profile.role as string));

  return hasValidRole;
}
