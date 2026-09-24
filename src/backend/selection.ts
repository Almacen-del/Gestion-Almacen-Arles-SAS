// Firebase is available only as an explicit local rollback preview.
export const USE_SUPABASE = !(import.meta.env.DEV && import.meta.env.VITE_BACKEND === 'firebase');
