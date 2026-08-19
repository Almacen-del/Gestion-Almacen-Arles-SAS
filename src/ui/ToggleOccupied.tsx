import React from 'react';
import { Eye as EyeIcon } from 'lucide-react';

export default function ToggleOccupied({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className={`filter-toggle ${active ? 'active' : ''}`}
        onClick={onToggle}
        aria-pressed={active}
        title={active ? 'Mostrar todo' : 'Mostrar solo ocupados'}
      >
        <EyeIcon size={14} />
        {active ? 'Ocupados' : 'Solo ocupados'}
      </button>
    </div>
  );
}
