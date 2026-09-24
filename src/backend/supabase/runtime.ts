import {createWebSupabaseClient,SUPABASE_PROJECT_URL} from './client';
import type {SupabaseClient} from '@supabase/supabase-js';
let client:SupabaseClient|undefined;
export function webSupabaseClient(){
  return client??=createWebSupabaseClient(SUPABASE_PROJECT_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY??'');
}
