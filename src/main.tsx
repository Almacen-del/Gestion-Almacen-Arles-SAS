import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import ErrorBoundary from './ErrorBoundary';
import StartupScreen from './StartupScreen';
import { validateFirebaseEnvironment } from './startupConfig';
import { setupGlobalErrorHandler } from './utils/logger';
import './styles.css';

// Inicializar manejador global de errores
setupGlobalErrorHandler();

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
    const [{ auth }, { configureBrowserAuthPersistence }] = await Promise.all([
      import('./firebase'),
      import('./auth/browserAuth'),
    ]);
    await configureBrowserAuthPersistence(auth);
    const { App } = await import('./App');
    root.render(
      <StrictMode>
        <ErrorBoundary onSignOut={closeSessionAndReload}>
          <App />
          <Analytics />
        </ErrorBoundary>
      </StrictMode>,
    );
  } catch (error) {
    console.error('No se pudo importar o inicializar la aplicación:', error);
    root.render(<StartupScreen state="initialization-error" />);
  }
}

void bootstrap().catch((error) => {
  console.error('Fallo no controlado durante el arranque:', error);
  root.render(<StartupScreen state="initialization-error" />);
});
