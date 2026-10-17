import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, Wine } from 'lucide-react';
import { BottleLevel } from '../lib/types';

const COLOR = { ok: '#c9a96e', low: '#f59e0b', empty: '#ef4444' } as const;

// Botellita que se va vaciando. `pct` es lo que queda de la botella en uso.
export const Bottle: React.FC<{ pct: number; status: BottleLevel['status']; size?: number }> = ({ pct, status, size = 44 }) => {
  const color = COLOR[status];
  // Cuerpo de la botella: y de 30 a 96 (66 de alto).
  const fillH = (Math.max(0, Math.min(100, pct)) / 100) * 66;
  const id = React.useId();
  return (
    <svg
      width={size * 0.5}
      height={size}
      viewBox="0 0 50 100"
      aria-hidden
      className={status === 'empty' ? 'opacity-70' : status === 'low' ? 'bottle-pulse' : ''}
    >
      <defs>
        <clipPath id={id}>
          <path d="M19 4h12v18c0 5 9 8 9 20v50a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5V42c0-12 9-15 9-20z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect x="0" y="0" width="50" height="100" fill="#0d0809" />
        {/* El licor baja suave cada vez que se vende un trago. */}
        <g style={{ transform: `translateY(${96 - fillH}px)`, transition: 'transform 1.2s cubic-bezier(.4,0,.2,1)' }}>
          <rect x="-10" y="0" width="70" height="70" fill={color} opacity="0.9" />
          {fillH > 0 && (
            <path className="bottle-wave" d="M-10 0 q8.75 -4 17.5 0 t17.5 0 t17.5 0 t17.5 0 t17.5 0 V6 H-10z" fill={color} opacity="0.6" />
          )}
        </g>
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

// ml que quedan en la botella que se está usando (sin contar las de reserva).
export const currentMl = (b: BottleLevel) => Math.max(0, Math.round(b.remainingMl - b.spareBottles * b.bottleMl));

// Botón del bartender: registra que tomó otra botella (pasa de venta a cocteleria).
const TakeButton: React.FC<{ onTake: () => void; busy?: boolean }> = ({ onTake, busy }) => (
  <button className="btn btn-gold !py-2 text-sm mt-2" disabled={busy} onClick={onTake}>
    <Wine className="w-4 h-4" /> Ya tomé otra botella
  </button>
);

// Franja de alerta: sale cuando hay botellas por acabarse o que ya no alcanzan
// para otro trago. La ven el cajero y el bartender; solo el bartender recibe el
// botón "Ya tomé otra botella" (onTake).
export const BottleAlerts: React.FC<{
  levels: BottleLevel[];
  onTake?: (itemId: string, name: string) => void;
  busyId?: string;
}> = ({ levels, onTake, busyId }) => {
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
              {b.status === 'empty' ? (b.remainingMl > 0 ? 'No alcanza para otro trago' : 'Se acabó') : 'Se está acabando'}: {b.name}
            </p>
            <p className="text-sm text-cream/85">
              {b.status === 'empty'
                ? `Hay que tomar otra botella${b.remainingMl > 0 ? ` (solo quedan ${currentMl(b)} ml)` : ''}.`
                : `Trae una nueva botella (quedan ${currentMl(b)} de ${b.bottleMl} ml).`}
            </p>
            {onTake && <TakeButton busy={busyId === b.itemId} onTake={() => onTake(b.itemId, b.name)} />}
          </div>
        </div>
      ))}
    </div>
  );
};

// Apartado "Botellas de este pedido": cuánto queda de cada botella que usa y si
// alcanza. Se muestra al vender (cajero) y al tomar el pedido (bartender).
export interface BottleNeed {
  itemId: string;
  ml: number; // ml que gasta el pedido de esa botella
}

export const BottleNeeds: React.FC<{
  needs: BottleNeed[];
  levels: BottleLevel[];
  names: Record<string, string>;
  onTake?: (itemId: string, name: string) => void;
  busyId?: string;
  title?: string;
}> = ({ needs, levels, names, onTake, busyId, title = 'Botellas de este pedido' }) => {
  if (needs.length === 0) return null;
  return (
    <div className="rounded-xl border border-gold/25 bg-black/30 p-3 space-y-2.5">
      <p className="text-xs text-cream/60">{title}</p>
      {needs.map(n => {
        const lv = levels.find(l => l.itemId === n.itemId);
        const name = lv?.name ?? names[n.itemId] ?? 'Botella';
        const left = lv ? lv.remainingMl : 0;
        const enough = !!lv && left >= n.ml;
        const status: BottleLevel['status'] = !lv || !enough ? 'empty' : lv.status;
        return (
          <div key={n.itemId} className="flex items-start gap-3">
            <Bottle pct={lv?.currentPct ?? 0} status={status} size={48} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{name}</p>
              <p className="text-xs text-cream/70">
                {lv ? `Quedan ${currentMl(lv)} de ${lv.bottleMl} ml${lv.spareBottles > 0 ? ` (+${lv.spareBottles} de reserva)` : ''}` : 'No hay botella cargada en cocteleria'}
                {' · '}este pedido gasta {Math.round(n.ml)} ml
              </p>
              {enough ? (
                <p className={`text-xs mt-0.5 ${status === 'low' ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {status === 'low' ? 'Alcanza, pero queda poco: trae otra botella pronto' : 'Alcanza'}
                </p>
              ) : (
                <>
                  <p className="text-xs mt-0.5 text-red-300 font-semibold">No alcanza: hay que tomar otra botella</p>
                  {onTake && <TakeButton busy={busyId === n.itemId} onTake={() => onTake(n.itemId, name)} />}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Todas las botellitas de cocteleria, para ver de un vistazo cómo van.
export const BottleShelf: React.FC<{ levels: BottleLevel[]; defaultOpen?: boolean }> = ({ levels, defaultOpen = true }) => {
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
              <p className={`text-[11px] font-semibold ${b.status === 'ok' ? 'text-cream/80' : b.status === 'low' ? 'text-amber-300' : 'text-red-300'}`}>
                {b.status === 'empty' ? 'Vacía' : `${currentMl(b)} / ${b.bottleMl} ml`}
              </p>
              {b.spareBottles > 0 && <p className="text-[10px] text-cream/50">+{b.spareBottles} de reserva</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
