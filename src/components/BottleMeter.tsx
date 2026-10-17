import React, { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { BottleLevel } from '../lib/types';

const COLOR = { ok: '#c9a96e', low: '#f59e0b', empty: '#ef4444' } as const;

// Botellita que se va vaciando. `pct` es lo que queda de la botella en uso.
export const Bottle: React.FC<{ pct: number; status: BottleLevel['status']; size?: number }> = ({ pct, status, size = 44 }) => {
  const color = COLOR[status];
  // Cuerpo de la botella: y de 30 a 96 (66 de alto).
  const fillH = (Math.max(0, Math.min(100, pct)) / 100) * 66;
  const id = React.useId();
  return (
    <svg width={size * 0.5} height={size} viewBox="0 0 50 100" aria-hidden className={status === 'empty' ? 'opacity-70' : ''}>
      <defs>
        <clipPath id={id}>
          <path d="M19 4h12v18c0 5 9 8 9 20v50a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5V42c0-12 9-15 9-20z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect x="0" y="0" width="50" height="100" fill="#0d0809" />
        <rect x="0" y={96 - fillH} width="50" height={fillH} fill={color} opacity="0.9" />
      </g>
      <path
        d="M19 4h12v18c0 5 9 8 9 20v50a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5V42c0-12 9-15 9-20z"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
      />
    </svg>
  );
};

// Franja de alerta: sale cuando hay botellas por acabarse. Es la misma para
// el cajero de barra y el bartender.
export const BottleAlerts: React.FC<{ levels: BottleLevel[] }> = ({ levels }) => {
  const bad = levels.filter(b => b.status !== 'ok');
  if (bad.length === 0) return null;
  return (
    <div className="mb-3 space-y-2" role="alert">
      {bad.map(b => (
        <div
          key={b.itemId}
          className={`card p-3 flex items-center gap-3 ${b.status === 'empty' ? 'border-red-400/70 bg-red-950/40' : 'border-amber-400/70 bg-amber-950/30'}`}
        >
          <Bottle pct={b.currentPct} status={b.status} size={46} />
          <div className="min-w-0">
            <p className={`font-semibold flex items-center gap-1.5 ${b.status === 'empty' ? 'text-red-200' : 'text-amber-200'}`}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {b.status === 'empty' ? 'Se acabó' : 'Se está acabando'}: {b.name}
            </p>
            <p className="text-sm text-cream/85">
              Trae una nueva botella{b.status === 'low' ? ` (queda ${Math.round(b.remainingMl)} ml)` : ''}.
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

// Todas las botellitas de cocteleria, para ver de un vistazo cómo van.
export const BottleShelf: React.FC<{ levels: BottleLevel[]; defaultOpen?: boolean }> = ({ levels, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  if (levels.length === 0) return null;
  return (
    <div className="card p-3 mb-3">
      <button className="w-full flex items-center justify-between text-sm text-cream/80" onClick={() => setOpen(o => !o)}>
        <span>Botellas de cocteleria ({levels.length})</span>
        <ChevronDown className={`w-4 h-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {levels.map(b => (
            <div key={b.itemId} className="flex flex-col items-center text-center">
              <Bottle pct={b.currentPct} status={b.status} size={64} />
              <p className="text-[11px] leading-tight mt-1 line-clamp-2">{b.name}</p>
              <p className={`text-[10px] ${b.status === 'ok' ? 'text-cream/50' : b.status === 'low' ? 'text-amber-300' : 'text-red-300'}`}>
                {b.status === 'empty' ? 'Vacía' : `${b.currentPct}%`}
                {b.spareBottles > 0 ? ` · +${b.spareBottles}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
