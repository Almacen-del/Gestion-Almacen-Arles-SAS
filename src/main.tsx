import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './ErrorBoundary';
import StartupScreen from './StartupScreen';
import { validateFirebaseEnvironment } from './startupConfig';
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
  const validation = validateFirebaseEnvironment(import.meta.env);
  if (!validation.valid) {
    root.render(<StartupScreen state="missing-config" missingVariables={validation.missingVariables} />);
    return;
  }

  try {
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
