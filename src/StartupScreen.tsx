import type { FirebaseEnvironmentVariable } from './startupConfig';

export default function StartupScreen({
  state,
  missingVariables = [],
}: {
  state: 'loading' | 'missing-config' | 'initialization-error';
  missingVariables?: FirebaseEnvironmentVariable[];
}) {
  if (state === 'loading') {
    return (
      <main className="startup-shell">
        <section className="startup-card">
          <span className="loading-dot" />
          <h1>Iniciando Gestión de Almacén</h1>
          <p>Validando la configuración local y la conexión segura.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="startup-shell" role="alert">
      <section className="startup-card startup-error-card">
        <p className="eyebrow">No fue posible iniciar</p>
        <h1>{state === 'missing-config' ? 'Falta configuración de Firebase' : 'Firebase no pudo inicializarse'}</h1>
        {state === 'missing-config' ? (
          <>
            <p>Configura estas variables en <code>.env.local</code>. Sus valores no se muestran por seguridad.</p>
            <ul>{missingVariables.map((variable) => <li key={variable}><code>{variable}</code></li>)}</ul>
          </>
        ) : (
          <p>Revisa la configuración local y vuelve a intentar. No se expusieron credenciales ni detalles internos.</p>
        )}
        <div className="startup-actions">
          <button type="button" onClick={() => window.location.reload()}>Reintentar</button>
        </div>
      </section>
    </main>
  );
}
