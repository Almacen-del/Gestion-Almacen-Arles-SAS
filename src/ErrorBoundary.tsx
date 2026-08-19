import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Logger } from './utils/logger';

type ErrorBoundaryProps = {
  children: ReactNode;
  onSignOut: () => Promise<void>;
};

type ErrorBoundaryState = {
  failed: boolean;
  signingOut: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
};

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, signingOut: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { failed: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });
    
    // Log del error
    Logger.error(error, {
      component: 'ErrorBoundary',
      action: 'componentDidCatch',
      metadata: {
        componentStack: info.componentStack,
      },
    });

    // También loguear en consola
    console.error('❌ Error inesperado en la interfaz del programa:');
    console.error('Error:', error);
    console.error('Stack:', info.componentStack);
  }

  private signOut = async () => {
    if (this.state.signingOut) return;
    this.setState({ signingOut: true });
    try {
      await this.props.onSignOut();
      Logger.auth('sign_out', 'unknown', true, { reason: 'error_boundary' });
    } catch (e) {
      Logger.error(e instanceof Error ? e : new Error(String(e)), {
        component: 'ErrorBoundary',
        action: 'signOut_failed',
      });
    }
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="startup-shell" role="alert">
        <section className="startup-card">
          <p className="eyebrow">⚠️ Recuperación segura</p>
          <h1>El programa encontró un error inesperado</h1>
          <p>
            La interfaz se detuvo para evitar una pantalla vacía. Puedes recargar o cerrar la sesión actual.
          </p>
          
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{ marginTop: '1rem', fontSize: '0.85rem', textAlign: 'left', color: '#888' }}>
              <summary>Detalles del error (solo desarrollo)</summary>
              <pre style={{ 
                background: '#f5f5f5', 
                padding: '0.5rem', 
                borderRadius: '4px',
                overflowX: 'auto',
                marginTop: '0.5rem'
              }}>
{`${this.state.error.message}

${this.state.errorInfo?.componentStack || 'Stack no disponible'}`}
              </pre>
            </details>
          )}

          <div className="startup-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Recargar página
            </button>
            <button 
              type="button" 
              className="secondary" 
              disabled={this.state.signingOut} 
              onClick={() => { void this.signOut(); }}
            >
              {this.state.signingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
            </button>
          </div>
        </section>
      </main>
    );
  }
}
