import React from 'react';
import { ArrowLeft, LogOut, Wifi, WifiOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { EventLite } from '../lib/types';

interface Props {
  title: string;
  events: EventLite[];
  eventId: string;
  onEvent: (id: string) => void;
  onBack?: () => void;
  online: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}

export const Shell: React.FC<Props> = ({ title, events, eventId, onEvent, onBack, online, right, children }) => (
  <div className="min-h-screen flex flex-col">
    <header className="sticky top-0 z-30 bg-ink/95 backdrop-blur border-b border-gold/20 px-3 sm:px-5 py-2.5 flex items-center gap-2">
      {onBack && (
        <button onClick={onBack} className="p-2 rounded-lg text-gold-soft hover:bg-white/5" aria-label="Volver">
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}
      <div className="min-w-0">
        <p className="font-display text-lg text-cream leading-none truncate">{title}</p>
        <span className={`flex items-center gap-1 text-[10px] mt-1 ${online ? 'text-emerald-300/80' : 'text-red-300'}`}>
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {online ? 'En línea' : 'Sin señal'}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {right}
        {events.length > 1 && (
          <select className="input !w-auto !py-2 text-sm" value={eventId} onChange={e => onEvent(e.target.value)}>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.city}
              </option>
            ))}
          </select>
        )}
        {events.length === 1 && <span className="text-sm text-gold-soft">{events[0].city}</span>}
        <button
          onClick={() => {
            if (confirm('¿Cerrar sesión?')) supabase.auth.signOut();
          }}
          className="p-2 rounded-lg text-cream/50 hover:text-cream"
          aria-label="Cerrar sesión"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
    <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-5 py-4">{children}</main>
  </div>
);
