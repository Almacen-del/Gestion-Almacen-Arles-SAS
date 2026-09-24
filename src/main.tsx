import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './ErrorBoundary';
import StartupScreen from './StartupScreen';
import { USE_SUPABASE } from './backend/selection';
import { initializeMonitoring, Logger, setupGlobalErrorHandler } from './utils/logger';
import { retireLegacyPwa } from './retireLegacyPwa';
import { APP_RELEASE } from './release';
import './styles.css';

// Inicializar manejador global de errores
setupGlobalErrorHandler();
void retireLegacyPwa().catch((error) => Logger.error(error, { component: 'retireLegacyPwa' }));

const rootElement = document.getElementById('root') ?? (() => {
  const fallbackRoot = document.createElement('div');
  fallbackRoot.id = 'root';
  document.body.append(fallbackRoot);
  return fallbackRoot;
})();
const root = createRoot(rootElement);

root.render(<StartupScreen state="loading" />);

async function closeSessionAndReload() {
  try {
    if(USE_SUPABASE) {
      const {webSupabaseClient}=await import('./backend/supabase/runtime');
      await webSupabaseClient().auth.signOut({scope:'local'});
      return;
    }
    const [{ signOut }, { auth }] = await Promise.all([
      import('firebase/auth'),
      import('./firebase'),
    ]);
    await signOut(auth);
  } catch (error) {
    console.error('No se pudo cerrar limpiamente la sesión después del error:', error);
  } finally {
    window.location.reload();
  }
}

async function bootstrap() {
  try {
    if(USE_SUPABASE) {
      const {default:Panel}=import.meta.env.DEV && new URLSearchParams(window.location.search).get('review')==='valuations'
        ? await import('./ui/SupabaseValuations') : await import('./ui/SupabasePanel');
      root.render(<StrictMode><ErrorBoundary onSignOut={closeSessionAndReload}><Panel/></ErrorBoundary></StrictMode>);
      return;
    }
    const [{ auth, firebaseApp }, { configureBrowserAuthPersistence }] = await Promise.all([
      import('./firebase'),
      import('./auth/browserAuth'),
    ]);
    // Optional telemetry must neither precede Firebase nor delay opening the panel.
    void initializeMonitoring(firebaseApp, { enabled: import.meta.env.PROD && import.meta.env.VITE_MONITORING_ENABLED === 'true' });
    await configureBrowserAuthPersistence(auth);
    const { App } = await import('./App');
    root.render(
      <StrictMode>
        <ErrorBoundary onSignOut={closeSessionAndReload}>
          <App />
          <footer style={{ padding: '6px 16px', textAlign: 'right', fontSize: '11px', color: '#496254' }}>
            Versión {APP_RELEASE.id}
          </footer>
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (error) {
    Logger.error(error instanceof Error ? error : String(error), { component: 'bootstrap' });
    console.error('No se pudo importar o inicializar la aplicación:', error);
    root.render(<StartupScreen state="initialization-error" />);
  }
}

void bootstrap().catch((error) => {
  Logger.error(error instanceof Error ? error : String(error), { component: 'bootstrap' });
  console.error('Fallo no controlado durante el arranque:', error);
  root.render(<StartupScreen state="initialization-error" />);
});
