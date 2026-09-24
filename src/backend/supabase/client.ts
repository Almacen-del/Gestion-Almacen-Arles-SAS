import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {createSupabaseReaderTransport} from './transport';
import {SupabaseWarehouseReader} from './reader';

export const SUPABASE_PROJECT_URL = 'https://gfgsnnweyfryfcqdnlvw.supabase.co';

export function validateSupabaseConfig(url: string, publishableKey: string) {
  if (url !== SUPABASE_PROJECT_URL || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error('Configura el proyecto Supabase del almacén y su clave publicable.');
  }
}

/** Separate session namespace: Firebase credentials are never copied into Supabase. */
export function createWebSupabaseClient(url: string, publishableKey: string): SupabaseClient {
  validateSupabaseConfig(url,publishableKey);
  return createClient(url,publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,
      storageKey:'arles-web-supabase-session-v1',flowType:'pkce'},
  });
}

export function createWebWarehouseReader(client: SupabaseClient, publishableKey: string) {
  return new SupabaseWarehouseReader(createSupabaseReaderTransport({
    url:SUPABASE_PROJECT_URL,publishableKey,
    accessToken:async () => {
      const {data,error}=await client.auth.getSession();
      if(error || !data.session?.expires_at) return null;
      return {value:data.session.access_token,expiresAt:data.session.expires_at*1000};
    },
  }));
}

export async function signInToWeb(client: SupabaseClient,email: string,password: string) {
  const normalized=email.trim().toLowerCase();
  if(!/^[^\s@]+@arlessas\.com$/.test(normalized) || !password) throw new Error('Ingresa tu correo corporativo y contraseña.');
  const {data,error}=await client.auth.signInWithPassword({email:normalized,password});
  if(error?.code==='email_not_confirmed')throw new Error('Confirma tu correo antes de ingresar. Revisa también la carpeta de spam o reenvía la confirmación.');
  if(error || !data.session) throw new Error('No se pudo iniciar sesión. Verifica el correo y la contraseña.');
  return data.session;
}

export function validateEvidencePath(path: string) {
  // Both mobile apps use this private bucket. Never accept a source URL, query string,
  // relative traversal or encoded separator in place of a storage object path.
  if(!path || path.startsWith('/') || path.includes('..') || !/^[A-Za-z0-9_/-]+\.(jpg|jpeg)$/.test(path))
    throw new Error('Ruta de evidencia no válida.');
}

export async function loadPrivateEvidence(client: SupabaseClient,path: string): Promise<Blob> {
  validateEvidencePath(path);
  const {data,error}=await client.storage.from('movement-evidence').download(path);
  if(error || !data) throw new Error('No se pudo consultar la evidencia. Revisa tu sesión y conexión.');
  return data;
}
