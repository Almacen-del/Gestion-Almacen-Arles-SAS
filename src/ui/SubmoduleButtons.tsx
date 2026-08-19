import React from 'react';
import { etiquetaSubmoduloTaller } from '../tallerCanonicos';

export default function SubmoduleButtons({
  submodules,
  selected,
  onSelect,
  counts,
  allCount,
  formatLabel = etiquetaSubmoduloTaller,
  ariaLabel = 'Submódulos',
}: {
  submodules: readonly string[];
  selected: string;
  onSelect: (s: string) => void;
  counts?: Record<string, string | number>;
  allCount?: number;
  formatLabel?: (value: string) => string;
  ariaLabel?: string;
}) {
  // keyboard navigation: left/right arrows change selection
  function handleKey(e: React.KeyboardEvent, index: number) {
    if (e.key === 'ArrowRight') {
      const next = (index + 1) % (submodules.length + 1);
      if (next === 0) onSelect(''); else onSelect(submodules[next - 1]);
    } else if (e.key === 'ArrowLeft') {
      const prev = (index - 1 + (submodules.length + 1)) % (submodules.length + 1);
      if (prev === 0) onSelect(''); else onSelect(submodules[prev - 1]);
    }
  }

  return (
    <section className="taller-submodulo-bar" aria-label={ariaLabel} role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={!selected}
        className={!selected ? 'active' : ''}
        onKeyDown={(e) => handleKey(e, 0)}
        onClick={() => onSelect('')}
      >
        Todos <span className="submodule-badge">{allCount ?? 0}</span>
      </button>
      {submodules.map((sub, i) => (
        <button
          key={sub}
          type="button"
          role="tab"
          aria-selected={selected === sub}
          className={selected === sub ? 'active' : ''}
          onKeyDown={(e) => handleKey(e, i + 1)}
          onClick={() => onSelect(sub)}
        >
          {formatLabel(sub)} <span className="submodule-badge">{counts?.[sub] ?? 0}</span>
        </button>
      ))}
    </section>
  );
}
