import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, BookOpen, ClipboardList, Wine, Search, RefreshCw } from 'lucide-react';
import { Shell } from '../components/Shell';
import { useBottleLevels } from '../lib/bottles';
import { BottleAlerts, BottleShelf } from '../components/BottleMeter';
import { useCatalog } from '../lib/catalog';
import { supabase, errText } from '../lib/supabase';
import { Access, BarProduct, EventLite } from '../lib/types';
import { SPIRITS, spiritLabel } from '../lib/format';

interface Props {
  event: EventLite;
  events: EventLite[];
  eventId: string;
  onEvent: (id: string) => void;
  online: boolean;
  onBack: () => void;
  access: Access;
}

interface Order {
  id: string;
  number: number;
  created_at: string;
  payment_method: string;
  items: { name: string; qty: number; product_id: string | null }[];
}

type Tab = 'pedidos' | 'recetas' | 'botella';

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'ahora' : `hace ${m} min`;
};

export const Bartender: React.FC<Props> = ({ event, events, eventId, onEvent, online, onBack }) => {
  const { products, items } = useCatalog(event.id);
  const { levels, reload: reloadLevels } = useBottleLevels(event.id);
  const [tab, setTab] = useState<Tab>('pedidos');
  const [orders, setOrders] = useState<Order[]>([]);
  const [recipe, setRecipe] = useState<BarProduct | null>(null);
  const [search, setSearch] = useState('');
  const [spirit, setSpirit] = useState('todos');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');

  const loadOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('bar_orders')
      .select('id, number, created_at, payment_method, bar_order_items(name, qty, product_id)')
      .eq('event_id', event.id)
      .eq('status', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(60);
    if (error) return;
    setOrders(
      ((data ?? []) as unknown as (Omit<Order, 'items'> & { bar_order_items: Order['items'] })[]).map(o => ({
        ...o,
        items: o.bar_order_items ?? [],
      }))
    );
  }, [event.id]);

  useEffect(() => {
    loadOrders();
    const t = setInterval(loadOrders, 5000);
    return () => clearInterval(t);
  }, [loadOrders]);

  const deliver = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc('bar_mark_delivered', { p_order_id: id });
    setBusy('');
    if (error) setMsg({ ok: false, text: errText(error) });
    else setOrders(o => o.filter(x => x.id !== id));
  };

  const takeBottle = async (itemId: string, name: string) => {
    if (!confirm(`¿Registrar que tomaste 1 botella de ${name} (de las de venta) para cocteleria?`)) return;
    setBusy(itemId);
    const { error } = await supabase.rpc('bar_stock_move', {
      p_event_id: event.id,
      p_item_id: itemId,
      p_kind: 'traslado',
      p_pool: null,
      p_bottles: 1,
      p_ml: 0,
      p_note: 'Bartender tomó botella para cocteleria',
    });
    setBusy('');
    setMsg(error ? { ok: false, text: errText(error) } : { ok: true, text: `Registrado: 1 botella de ${name} pasó a cocteleria.` });
    if (!error) reloadLevels();
  };

  const recipes = useMemo(
    () =>
      products
        .filter(p => p.kind !== 'botella' && (p.kind !== 'sin_alcohol' || !!p.recipe))
        .filter(p => spirit === 'todos' || p.spirit === spirit)
        .filter(p => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())),
    [products, spirit, search]
  );
  const imageOf = (productId: string | null, name: string) =>
    (products.find(p => p.id === productId) ?? products.find(p => p.name === name))?.image_url ?? null;
  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? 'Licor';
  const openRecipe = (productId: string | null, name: string) =>
    setRecipe(products.find(p => p.id === productId) ?? products.find(p => p.name === name) ?? null);

  return (
    <Shell title="Bartender" events={events} eventId={eventId} onEvent={onEvent} online={online} onBack={onBack}>
      <div className="flex gap-2 mb-4 overflow-x-auto">
        <button className={`chip ${tab === 'pedidos' ? 'chip-on' : ''}`} onClick={() => setTab('pedidos')}>
          <ClipboardList className="w-4 h-4 inline -mt-0.5 mr-1" />
          Pedidos {orders.length > 0 && `(${orders.length})`}
        </button>
        <button className={`chip ${tab === 'recetas' ? 'chip-on' : ''}`} onClick={() => setTab('recetas')}>
          <BookOpen className="w-4 h-4 inline -mt-0.5 mr-1" />
          Recetas
        </button>
        <button className={`chip ${tab === 'botella' ? 'chip-on' : ''}`} onClick={() => setTab('botella')}>
          <Wine className="w-4 h-4 inline -mt-0.5 mr-1" />
          Tomé otra botella
        </button>
      </div>

      <BottleAlerts levels={levels} />

      {msg && <p className={`text-sm mb-3 ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}

      {tab === 'pedidos' && (
        <>
          {!online && (
            <p className="text-sm text-red-200 mb-3">Sin señal: los pedidos nuevos no llegan. El cajero te los dicta.</p>
          )}
          <div className="flex justify-end mb-2">
            <button onClick={loadOrders} className="text-xs text-cream/50 flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Actualizar
            </button>
          </div>
          {orders.length === 0 ? (
            <div className="card p-8 text-center text-cream/50">No hay pedidos pendientes.</div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {orders.map(o => (
                <div key={o.id} className="card p-4 flex flex-col">
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-3xl text-gold-soft">#{o.number}</span>
                    <span className="text-xs text-cream/50">{ago(o.created_at)}</span>
                  </div>
                  <ul className="mt-3 space-y-1.5 flex-1">
                    {o.items.map(i => (
                      <li key={i.name}>
                        <button className="text-left w-full flex items-center gap-2" onClick={() => openRecipe(i.product_id, i.name)}>
                          {imageOf(i.product_id, i.name) && (
                            <img src={imageOf(i.product_id, i.name)!} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                          )}
                          <span>
                          <span className="text-xl font-semibold">{i.qty}×</span> <span className="text-lg">{i.name}</span>
                          <span className="text-[10px] text-gold ml-2 underline">receta</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button className="btn btn-gold w-full mt-4" disabled={busy === o.id} onClick={() => deliver(o.id)}>
                    <CheckCircle2 className="w-5 h-5" /> Entregado
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'recetas' && (
        <>
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gold" />
            <input className="input !pl-9" placeholder="Buscar cóctel" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-3">
            <button className={`chip ${spirit === 'todos' ? 'chip-on' : ''}`} onClick={() => setSpirit('todos')}>
              Todos
            </button>
            {SPIRITS.filter(s => products.some(p => p.spirit === s.key && p.kind !== 'botella')).map(s => (
              <button key={s.key} className={`chip ${spirit === s.key ? 'chip-on' : ''}`} onClick={() => setSpirit(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {recipes.map(p => (
              <button key={p.id} className="card p-3 text-left flex items-center gap-3" onClick={() => setRecipe(p)}>
                {p.image_url && <img src={p.image_url} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
                <span>
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-xs text-cream/50">{spiritLabel(p.spirit)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'botella' && (
        <div className="card p-4">
          <BottleShelf levels={levels} defaultOpen />
          <p className="text-sm text-cream/70 mb-3">
            Si se acabó el licor de cocteleria y tomas una botella de las de venta, regístralo aquí. Así el inventario cuadra.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {items
              .filter(i => i.active)
              .map(i => (
                <button
                  key={i.id}
                  disabled={busy === i.id || !online}
                  onClick={() => takeBottle(i.id, i.name)}
                  className="p-3 rounded-xl border border-gold/25 bg-black/40 text-left hover:border-gold disabled:opacity-40"
                >
                  <p className="font-semibold">{i.name}</p>
                  <p className="text-xs text-cream/50">
                    {spiritLabel(i.spirit)} · {i.bottle_ml} ml
                  </p>
                </button>
              ))}
          </div>
        </div>
      )}

      {recipe && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-end sm:items-center justify-center p-3" onClick={() => setRecipe(null)}>
          <div className="card w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {recipe.image_url && <img src={recipe.image_url} alt={recipe.name} className="w-full h-48 object-cover rounded-xl mb-3" />}
            <p className="font-display text-2xl">{recipe.name}</p>
            <p className="text-xs text-gold mt-1">{spiritLabel(recipe.spirit)}</p>
            {recipe.ingredients && recipe.ingredients.length > 0 && (
              <ul className="mt-4 space-y-1">
                {recipe.ingredients.map(ing => (
                  <li key={ing.item_id} className="flex justify-between border-b border-gold/10 pb-1">
                    <span>{itemName(ing.item_id)}</span>
                    <span className="text-gold-soft">{ing.ml} ml</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="whitespace-pre-line text-cream/85 mt-4 leading-relaxed">{recipe.recipe || 'Sin receta cargada.'}</p>
            <button className="btn btn-ghost w-full mt-5" onClick={() => setRecipe(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
};
