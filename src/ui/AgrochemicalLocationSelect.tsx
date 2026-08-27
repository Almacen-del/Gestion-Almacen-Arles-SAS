import { useRef, useState } from 'react';
import { AGROQUIMICOS_UBICACIONES, type AgroquimicosUbicacion } from '../agroquimicosCanonicos';
import { locationSaveErrorMessage } from '../agroquimicosUbicacion';

export default function AgrochemicalLocationSelect({ location, productLabel, blockedReason, onSave }: {
  location: string;
  productLabel: string;
  blockedReason: string;
  onSave: (location: AgroquimicosUbicacion) => Promise<unknown>;
}) {
  const busy = useRef(false);
  const [savingLocation, setSavingLocation] = useState<string | null>(null);
  const [savedLocation, setSavedLocation] = useState<string | null>(null);
  const [error, setError] = useState('');
  const saving = savingLocation !== null;

  async function changeLocation(nextLocation: string) {
    if (busy.current || blockedReason || nextLocation === location) return;
    const target = AGROQUIMICOS_UBICACIONES.find((value) => value === nextLocation);
    if (!target) return;
    busy.current = true;
    setSavingLocation(target);
    setSavedLocation(null);
    setError('');
    try {
      await onSave(target);
      setSavedLocation(target);
    } catch (cause) {
      setError(locationSaveErrorMessage(cause));
    } finally {
      busy.current = false;
      setSavingLocation(null);
    }
  }

  return <div className="agro-location-editor" aria-busy={saving}>
    <select
      aria-label={`Ubicación de ${productLabel}`}
      aria-invalid={Boolean(error)}
      value={savingLocation ?? location}
      disabled={saving || Boolean(blockedReason)}
      title={blockedReason || 'Cambiar ubicación y guardar en Firestore'}
      onChange={(event) => void changeLocation(event.target.value)}
    >
      {!AGROQUIMICOS_UBICACIONES.some((value) => value === location) && (
        <option value={location} disabled>{location || 'Sin ubicación'}</option>
      )}
      {AGROQUIMICOS_UBICACIONES.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
    {error
      ? <small className="agro-location-error" role="alert">{error}</small>
      : <small role="status" aria-live="polite">{saving ? 'Guardando…' : savedLocation === location ? 'Guardado' : ''}</small>}
  </div>;
}
