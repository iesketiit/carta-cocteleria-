import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Trash2, CheckCircle2, CloudOff, RefreshCw, AlertTriangle, BarChart3 } from 'lucide-react';
import { Shell } from '../components/Shell';
import { useCatalog } from '../lib/catalog';
import { enqueueOrder, syncOrders, useOrderQueue, discardOrder, retryOrder } from '../lib/offlineOrders';
import { supabase } from '../lib/supabase';
import { CartLine, EventLite, PayMethod } from '../lib/types';
import { money, SPIRITS, PAY_LABEL, uuid } from '../lib/format';

interface Props {
  event: EventLite;
  events: EventLite[];
  eventId: string;
  onEvent: (id: string) => void;
  online: boolean;
  onBack: () => void;
}

type Section = 'coctel' | 'botella' | 'sin_alcohol';

const SECTION_LABEL: Record<Section, string> = { coctel: 'Cócteles y shots', botella: 'Botellas', sin_alcohol: 'Sin alcohol' };

export const Barra: React.FC<Props> = ({ event, events, eventId, onEvent, online, onBack }) => {
  const { products, reload, loading } = useCatalog(event.id);
  const { pending, failed } = useOrderQueue();
  const [section, setSection] = useState<Section>('coctel');
  const [spirit, setSpirit] = useState<string>('todos');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pay, setPay] = useState<PayMethod>('efectivo');
  const [received, setReceived] = useState('');
  const [last, setLast] = useState<{ id: string; total: number; number?: number; lines: CartLine[] } | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<{ cashier: string; method: string; orders: number; total: number }[]>([]);

  // Número del pedido cuando llega a la base.
  useEffect(() => {
    const onSynced = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; number: number }>).detail;
      setLast(l => (l && l.id === d.id ? { ...l, number: d.number } : l));
    };
    window.addEventListener('403-synced', onSynced);
    return () => window.removeEventListener('403-synced', onSynced);
  }, []);

  const active = products.filter(p => p.active);
  const inSection = active.filter(p =>
    section === 'botella' ? p.kind === 'botella' : section === 'sin_alcohol' ? p.kind === 'sin_alcohol' : ['coctel', 'shot', 'otro'].includes(p.kind)
  );
  const spiritsHere = SPIRITS.filter(s => inSection.some(p => p.spirit === s.key));
  const visible = spirit === 'todos' ? inSection : inSection.filter(p => p.spirit === spirit);

  const total = useMemo(() => cart.reduce((s, l) => s + l.price * l.qty, 0), [cart]);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const receivedNum = Number(received.replace(',', '.')) || 0;

  const add = (id: string, name: string, price: number, delta: number) =>
    setCart(c => {
      const ex = c.find(l => l.productId === id);
      if (!ex) return delta > 0 ? [...c, { productId: id, name, price, qty: delta }] : c;
      return c.map(l => (l.productId === id ? { ...l, qty: l.qty + delta } : l)).filter(l => l.qty > 0);
    });

  const charge = () => {
    if (!cart.length) return;
    if (pay === 'efectivo' && received && receivedNum < total) {
      alert('El dinero recibido no alcanza.');
      return;
    }
    const id = uuid();
    enqueueOrder({
      id,
      eventId: event.id,
      payment: pay,
      items: cart.map(l => ({ productId: l.productId, qty: l.qty, name: l.name, price: l.price })),
      total,
      createdAt: new Date().toISOString(),
    });
    setLast({ id, total, lines: cart });
    setCart([]);
    setReceived('');
    syncOrders();
  };

  const loadSummary = async () => {
    const { data } = await supabase.rpc('bar_sales_summary', { p_event_id: event.id });
    setSummary(((data as { byCashier: typeof summary })?.byCashier ?? []).map(r => ({ ...r, total: Number(r.total) })));
  };

  return (
    <Shell
      title="Barra"
      events={events}
      eventId={eventId}
      onEvent={onEvent}
      online={online}
      onBack={onBack}
      right={
        pending > 0 ? (
          <span className="flex items-center gap-1 text-xs text-amber-300">
            <CloudOff className="w-4 h-4" /> {pending} por enviar
          </span>
        ) : null
      }
    >
      {failed.length > 0 && (
        <div className="card p-3 mb-3 border-red-400/40 text-sm">
          <p className="flex items-center gap-2 text-red-200">
            <AlertTriangle className="w-4 h-4" /> {failed.length} pedido(s) no se pudieron registrar
          </p>
          {failed.map(f => (
            <div key={f.id} className="flex items-center justify-between gap-2 mt-2 text-xs">
              <span>
                {f.items.map(i => `${i.qty}× ${i.name}`).join(', ')} · {money(f.total, event.currency)} — {f.error}
              </span>
              <span className="flex gap-2 shrink-0">
                <button className="btn btn-gold !py-2 !px-3" onClick={() => retryOrder(f.id)}>
                  Reintentar
                </button>
                <button className="btn btn-ghost !py-2 !px-3" onClick={() => confirm('¿Descartar este pedido? Ya no se registrará.') && discardOrder(f.id)}>
                  Descartar
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {last && (
        <div className="card p-4 mb-3 border-emerald-500/40 flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-emerald-300 font-semibold">
              <CheckCircle2 className="w-5 h-5" />
              {last.number ? `Pedido #${last.number} enviado al bartender` : 'Pedido guardado — se envía apenas haya señal'}
            </p>
            <p className="text-xs text-cream/60 mt-1">
              {last.lines.map(l => `${l.qty}× ${l.name}`).join(' · ')} · {money(last.total, event.currency)}
              {!last.number && ' · díctalo al bartender'}
            </p>
          </div>
          <button className="text-cream/50 text-xs underline" onClick={() => setLast(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {(Object.keys(SECTION_LABEL) as Section[]).map(s => (
              <button
                key={s}
                className={`chip ${section === s ? 'chip-on' : ''}`}
                onClick={() => {
                  setSection(s);
                  setSpirit('todos');
                }}
              >
                {SECTION_LABEL[s]}
              </button>
            ))}
            <button className="chip ml-auto" onClick={reload} aria-label="Actualizar carta">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {spiritsHere.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-3">
              <button className={`chip ${spirit === 'todos' ? 'chip-on' : ''}`} onClick={() => setSpirit('todos')}>
                Todos
              </button>
              {spiritsHere.map(s => (
                <button key={s.key} className={`chip ${spirit === s.key ? 'chip-on' : ''}`} onClick={() => setSpirit(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {products.length === 0 ? (
            <div className="card p-6 text-center text-sm text-cream/60">
              Aún no hay carta para {event.city}. El administrador la carga en "Inventario y carta".
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {visible.map(p => {
                const inCart = cart.find(l => l.productId === p.id)?.qty ?? 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p.id, p.name, p.price, 1)}
                    className={`card p-3.5 text-left min-h-[96px] flex flex-col justify-between active:scale-[0.98] transition ${
                      inCart ? 'border-gold' : ''
                    }`}
                  >
                    <span className="font-semibold leading-tight">{p.name}</span>
                    <span className="flex items-end justify-between mt-2">
                      <span className="text-gold-soft font-display text-lg">{money(p.price, event.currency)}</span>
                      {inCart > 0 && <span className="text-xs bg-wine px-2 py-0.5 rounded-full">×{inCart}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className="card p-4 h-fit lg:sticky lg:top-20">
          <p className="font-display text-lg mb-2">Pedido {count > 0 && <span className="text-sm text-cream/50">({count})</span>}</p>
          {cart.length === 0 ? (
            <p className="text-sm text-cream/50">Toca los productos para agregarlos.</p>
          ) : (
            <div className="space-y-2">
              {cart.map(l => (
                <div key={l.productId} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{l.name}</span>
                  <button className="p-1.5 rounded-lg border border-gold/30" onClick={() => add(l.productId, l.name, l.price, -1)}>
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-6 text-center">{l.qty}</span>
                  <button className="p-1.5 rounded-lg border border-gold/30" onClick={() => add(l.productId, l.name, l.price, 1)}>
                    <Plus className="w-4 h-4" />
                  </button>
                  <span className="w-16 text-right text-sm text-gold-soft">{money(l.price * l.qty, event.currency)}</span>
                </div>
              ))}
              <button className="text-xs text-cream/40 flex items-center gap-1" onClick={() => confirm('¿Vaciar el pedido?') && setCart([])}>
                <Trash2 className="w-3 h-3" /> Vaciar
              </button>
            </div>
          )}

          <div className="border-t border-gold/20 mt-3 pt-3 space-y-3">
            <div className="flex justify-between text-xl">
              <span>Total</span>
              <span className="font-display text-gold-soft">{money(total, event.currency)}</span>
            </div>
            <div className="flex gap-2">
              {(['efectivo', 'transferencia', 'deuna'] as PayMethod[]).map(m => (
                <button key={m} className={`chip flex-1 ${pay === m ? 'chip-on' : ''}`} onClick={() => setPay(m)}>
                  {PAY_LABEL[m]}
                </button>
              ))}
            </div>
            {pay === 'efectivo' && total > 0 && (
              <div>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="Recibí… (para el cambio)"
                  value={received}
                  onChange={e => setReceived(e.target.value.replace(/[^\d.,]/g, ''))}
                />
                {received && (
                  <p className={`text-sm mt-1 ${receivedNum < total ? 'text-red-300' : 'text-emerald-300'}`}>
                    {receivedNum < total
                      ? `Faltan ${money(total - receivedNum, event.currency)}`
                      : `Cambio: ${money(receivedNum - total, event.currency)}`}
                  </p>
                )}
              </div>
            )}
            {pay !== 'efectivo' && total > 0 && (
              <p className="text-xs text-amber-200/80">Cobra solo cuando veas la transferencia / pago DeUna confirmado.</p>
            )}
            <button className="btn btn-gold w-full text-lg" disabled={!cart.length} onClick={charge}>
              Cobrar {money(total, event.currency)}
            </button>
          </div>

          <button
            className="mt-4 text-xs text-cream/50 flex items-center gap-1"
            onClick={() => {
              setShowSummary(s => !s);
              if (!showSummary) loadSummary();
            }}
          >
            <BarChart3 className="w-3.5 h-3.5" /> Mi caja de barra
          </button>
          {showSummary && (
            <div className="mt-2 text-sm space-y-1">
              {summary.length === 0 && <p className="text-cream/50 text-xs">Sin ventas registradas (o sin señal).</p>}
              {summary.map(s => (
                <div key={s.cashier + s.method} className="flex justify-between">
                  <span>
                    {s.cashier} · {PAY_LABEL[s.method] ?? s.method} · {s.orders}
                  </span>
                  <span className="text-gold-soft">{money(s.total, event.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
};
