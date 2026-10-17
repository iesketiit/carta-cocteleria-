import React, { useEffect, useState } from 'react';
import { Banknote, ChefHat, GlassWater, Settings2, UserCheck, HandCoins } from 'lucide-react';
import { useAccess, can, myEvents } from './lib/access';
import { readLocal, writeLocal } from './lib/store';
import { Login } from './components/Login';
import { Shell } from './components/Shell';
import { Caja } from './pages/Caja';
import { Barra } from './pages/Barra';
import { Bartender } from './pages/Bartender';
import { Admin } from './pages/Admin';
import { Curador } from './pages/Curador';
import { Cobrar } from './pages/Cobrar';
import { StaffRole } from './lib/types';

type Route = '/' | '/caja' | '/barra' | '/bartender' | '/admin' | '/curador' | '/cobrar';

const SECTIONS: { route: Route; role: StaffRole; title: string; desc: string; Icon: React.FC<{ className?: string }> }[] = [
  { route: '/barra', role: 'cajero_barra', title: 'Vender en barra', desc: 'Cócteles y botellas. Cobra y manda el pedido al bartender.', Icon: GlassWater },
  { route: '/bartender', role: 'bartender', title: 'Bartender', desc: 'Pedidos por preparar, recetas y "tomé otra botella".', Icon: ChefHat },
  { route: '/caja', role: 'caja_entradas', title: 'Caja de entradas', desc: 'Cobro en efectivo a personas aprobadas (ej. D\'VORA).', Icon: Banknote },
  { route: '/curador', role: 'curador', title: 'Curaduría en vivo', desc: 'Acepta o rechaza las solicitudes de /envivo y manda el radicado.', Icon: UserCheck },
  { route: '/cobrar', role: 'caja_entradas', title: 'Cobrar en vivo', desc: 'Cobra en efectivo a los aceptados de /envivo (con su radicado).', Icon: HandCoins },
  { route: '/admin', role: 'inventario', title: 'Inventario y carta', desc: 'Productos, recetas, botellas, cierres y personal.', Icon: Settings2 },
];

const currentRoute = (): Route => {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  return (['/caja', '/barra', '/bartender', '/admin', '/curador', '/cobrar'].includes(p) ? p : '/') as Route;
};

export const App: React.FC = () => {
  const { session, access, loading } = useAccess();
  const [route, setRoute] = useState<Route>(currentRoute);
  const [online, setOnline] = useState(navigator.onLine);
  const events = myEvents(access);
  const [eventId, setEventId] = useState<string>(() => readLocal('403-barra-evento', ''));

  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('popstate', onPop);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (events.length && !events.some(e => e.id === eventId)) setEventId(events[0].id);
  }, [events, eventId]);
  useEffect(() => writeLocal('403-barra-evento', eventId), [eventId]);

  const go = (r: Route) => {
    window.history.pushState(null, '', r);
    setRoute(r);
    window.scrollTo(0, 0);
  };

  if (loading && !access) {
    return <div className="min-h-screen flex items-center justify-center text-gold">Cargando…</div>;
  }
  if (!session && navigator.onLine) return <Login />;
  if (!session && !access) return <Login />;

  if (!access || events.length === 0) {
    return (
      <Shell title="403" events={[]} eventId="" onEvent={() => {}} online={online}>
        <div className="card p-6 max-w-md mx-auto text-center mt-10">
          <p className="font-display text-xl">Sin permisos todavía</p>
          <p className="text-sm text-cream/60 mt-2">
            Pide al administrador de 403 que te asigne a la caja, la barra o el inventario.
          </p>
        </div>
      </Shell>
    );
  }

  const event = events.find(e => e.id === eventId) ?? events[0];
  const allowed = SECTIONS.filter(s => can(access, s.role, event.id));
  const section = SECTIONS.find(s => s.route === route);
  const shellProps = { events, eventId: event.id, onEvent: setEventId, online };

  // Sin permiso para esa sección en esta ciudad: se muestra el inicio.
  const view: Route = section && !can(access, section.role, event.id) ? '/' : route;

  if (view === '/caja') return <Caja {...shellProps} event={event} onBack={() => go('/')} />;
  if (view === '/barra') return <Barra {...shellProps} event={event} onBack={() => go('/')} />;
  if (view === '/bartender') return <Bartender {...shellProps} event={event} access={access} onBack={() => go('/')} />;
  if (view === '/curador') return <Curador {...shellProps} event={event} onBack={() => go('/')} />;
  if (view === '/cobrar') return <Cobrar {...shellProps} event={event} onBack={() => go('/')} />;
  if (view === '/admin') return <Admin {...shellProps} event={event} onBack={() => go('/')} />;

  return (
    <Shell title="403" {...shellProps}>
      <p className="text-sm text-cream/60 mb-4">Hola{access.name ? `, ${access.name.split(' ')[0]}` : ''}. ¿Qué vas a hacer?</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {allowed.map(({ route: r, title, desc, Icon }) => (
          <button key={r} onClick={() => go(r)} className="card p-5 text-left hover:border-gold/60 transition-colors">
            <Icon className="w-7 h-7 text-gold mb-3" />
            <p className="font-display text-xl text-cream">{title}</p>
            <p className="text-xs text-cream/55 mt-1">{desc}</p>
          </button>
        ))}
      </div>
    </Shell>
  );
};
