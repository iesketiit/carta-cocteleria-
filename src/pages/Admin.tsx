import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Save, X, RefreshCw, Trash2, ImagePlus } from 'lucide-react';
import { Shell } from '../components/Shell';
import { useCatalog } from '../lib/catalog';
import { supabase, errText } from '../lib/supabase';
import { uploadProductImage } from '../lib/images';
import { BarItem, BarProduct, EventLite } from '../lib/types';
import { KINDS, SPIRITS, money, spiritLabel, PAY_LABEL, ROLE_LABEL } from '../lib/format';

interface Props {
  event: EventLite;
  events: EventLite[];
  eventId: string;
  onEvent: (id: string) => void;
  online: boolean;
  onBack: () => void;
}

type Tab = 'carta' | 'botellas' | 'inventario' | 'cierre' | 'personal';
const TABS: { key: Tab; label: string }[] = [
  { key: 'carta', label: 'Carta' },
  { key: 'botellas', label: 'Licores' },
  { key: 'inventario', label: 'Inventario' },
  { key: 'cierre', label: 'Cierre / ventas' },
  { key: 'personal', label: 'Personal' },
];

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="text-xs text-cream/60">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

export const Admin: React.FC<Props> = ({ event, events, eventId, onEvent, online, onBack }) => {
  const [tab, setTab] = useState<Tab>('carta');
  const catalog = useCatalog(event.id);
  return (
    <Shell title="Inventario y carta" events={events} eventId={eventId} onEvent={onEvent} online={online} onBack={onBack}>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-2">
        {TABS.map(t => (
          <button key={t.key} className={`chip ${tab === t.key ? 'chip-on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {!online && <p className="text-sm text-red-200 mb-3">Sin señal: los cambios se guardan cuando vuelva la conexión.</p>}
      {tab === 'carta' && <CartaTab event={event} {...catalog} />}
      {tab === 'botellas' && <ItemsTab event={event} {...catalog} />}
      {tab === 'inventario' && <InventarioTab event={event} items={catalog.items} />}
      {tab === 'cierre' && <CierreTab event={event} />}
      {tab === 'personal' && <PersonalTab event={event} />}
    </Shell>
  );
};

// ---------------------------------------------------------------- Carta
const emptyProduct = (): BarProduct => ({
  id: '',
  event_id: '',
  name: '',
  kind: 'coctel',
  spirit: 'whisky',
  price: 0,
  bottle_item_id: null,
  recipe: '',
  description: '',
  image_url: null,
  active: true,
  sort: 0,
  ingredients: [],
});

const CartaTab: React.FC<{ event: EventLite; products: BarProduct[]; items: BarItem[]; reload: () => void }> = ({
  event,
  products,
  items,
  reload,
}) => {
  const [form, setForm] = useState<BarProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('todos');
  const [uploading, setUploading] = useState(false);

  const pickImage = async (file: File | undefined) => {
    if (!file || !form) return;
    setUploading(true);
    setMsg('');
    try {
      const url = await uploadProductImage(event.id, file);
      setForm(f => (f ? { ...f, image_url: url } : f));
    } catch (e) {
      setMsg((e as Error).message);
    }
    setUploading(false);
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setMsg('');
    const { error } = await supabase.rpc('bar_save_product', {
      p_event_id: event.id,
      p_id: form.id || null,
      p_name: form.name,
      p_kind: form.kind,
      p_spirit: form.spirit,
      p_price: Number(form.price) || 0,
      p_bottle_item_id: form.kind === 'botella' ? form.bottle_item_id : null,
      p_recipe: form.recipe,
      p_description: form.description,
      p_active: form.active,
      p_sort: Number(form.sort) || 0,
      p_ingredients: form.kind === 'botella' ? [] : (form.ingredients ?? []).map(i => ({ itemId: i.item_id, ml: i.ml })),
      p_image_url: form.image_url || null,
    });
    setBusy(false);
    if (error) setMsg(errText(error));
    else {
      setForm(null);
      reload();
    }
  };

  const list = products.filter(p => filter === 'todos' || p.spirit === filter || p.kind === filter);

  if (form) {
    const set = (patch: Partial<BarProduct>) => setForm({ ...form, ...patch });
    return (
      <div className="card p-4 space-y-3 max-w-2xl">
        <p className="font-display text-xl">{form.id ? 'Editar producto' : 'Nuevo producto'}</p>
        <Field label="Nombre">
          <input className="input" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Ej. Whisky Sour" />
        </Field>
        <div>
          <p className="text-xs text-cream/60 mb-1">Foto (se ve en la barra y en las recetas)</p>
          <div className="flex items-center gap-3">
            {form.image_url ? (
              <img src={form.image_url} alt="" className="w-24 h-24 rounded-xl object-cover border border-gold/30" />
            ) : (
              <div className="w-24 h-24 rounded-xl border border-dashed border-gold/30 flex items-center justify-center text-cream/30">
                <ImagePlus className="w-6 h-6" />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label className={`btn btn-ghost !py-2 text-sm cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <ImagePlus className="w-4 h-4" /> {uploading ? 'Subiendo…' : form.image_url ? 'Cambiar foto' : 'Subir foto'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => {
                    pickImage(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {form.image_url && (
                <button className="text-xs text-cream/50 underline text-left" onClick={() => set({ image_url: null })}>
                  Quitar foto
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select className="input" value={form.kind} onChange={e => set({ kind: e.target.value as BarProduct['kind'] })}>
              {KINDS.map(k => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Licor principal">
            <select className="input" value={form.spirit} onChange={e => set({ spirit: e.target.value })}>
              {SPIRITS.map(s => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Precio (${event.currency})`}>
            <input
              className="input"
              inputMode="decimal"
              value={String(form.price)}
              onChange={e => set({ price: e.target.value.replace(/[^\d.]/g, '') as unknown as number })}
            />
          </Field>
          <Field label="Orden en la carta">
            <input className="input" inputMode="numeric" value={String(form.sort)} onChange={e => set({ sort: Number(e.target.value) || 0 })} />
          </Field>
        </div>

        {form.kind === 'botella' ? (
          <Field label="¿Qué botella del inventario se vende?">
            <select className="input" value={form.bottle_item_id ?? ''} onChange={e => set({ bottle_item_id: e.target.value || null })}>
              <option value="">— Elige —</option>
              {items.map(i => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div>
            <p className="text-xs text-cream/60 mb-1">Ingredientes que descuentan inventario (ml por trago)</p>
            {(form.ingredients ?? []).map((ing, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <select
                  className="input"
                  value={ing.item_id}
                  onChange={e => {
                    const next = [...(form.ingredients ?? [])];
                    next[idx] = { ...ing, item_id: e.target.value };
                    set({ ingredients: next });
                  }}
                >
                  <option value="">— Licor —</option>
                  {items.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input !w-24"
                  inputMode="decimal"
                  value={String(ing.ml)}
                  onChange={e => {
                    const next = [...(form.ingredients ?? [])];
                    next[idx] = { ...ing, ml: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 };
                    set({ ingredients: next });
                  }}
                  placeholder="ml"
                />
                <button className="btn btn-ghost !px-3" onClick={() => set({ ingredients: (form.ingredients ?? []).filter((_, i) => i !== idx) })}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button className="btn btn-ghost !py-2 text-sm" onClick={() => set({ ingredients: [...(form.ingredients ?? []), { item_id: '', ml: 60 }] })}>
              <Plus className="w-4 h-4" /> Agregar licor
            </button>
          </div>
        )}

        {form.kind !== 'botella' && (
          <Field label="Receta para el bartender (pasos)">
            <textarea
              className="input min-h-[140px]"
              value={form.recipe ?? ''}
              onChange={e => set({ recipe: e.target.value })}
              placeholder={'1. Vaso con hielo\n2. 60 ml de whisky\n3. 30 ml de limón\n4. Agitar y servir'}
            />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })} /> Se vende (visible en la barra)
        </label>
        {msg && <p className="text-sm text-red-300">{msg}</p>}
        <div className="flex gap-2">
          <button className="btn btn-gold" disabled={busy || !form.name.trim()} onClick={save}>
            <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button className="btn btn-ghost" onClick={() => setForm(null)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <button className="btn btn-gold !py-2" onClick={() => setForm(emptyProduct())}>
          <Plus className="w-4 h-4" /> Nuevo producto
        </button>
        <select className="input !w-auto !py-2 text-sm" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="todos">Todos</option>
          {SPIRITS.map(s => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
          <option value="botella">Botellas</option>
          <option value="sin_alcohol">Sin alcohol</option>
        </select>
        <button className="chip" onClick={reload}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {items.length === 0 && (
        <p className="text-sm text-amber-200/80 mb-3">Primero agrega los licores en la pestaña "Licores" para poder armar recetas.</p>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        {list.map(p => (
          <button key={p.id} className={`card p-3 text-left flex gap-3 ${p.active ? '' : 'opacity-50'}`} onClick={() => setForm({ ...p })}>
            {p.image_url && <img src={p.image_url} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
            <div className="flex-1 min-w-0">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{p.name}</span>
              <span className="text-gold-soft">{money(p.price, event.currency)}</span>
            </div>
            <p className="text-xs text-cream/50 mt-0.5">
              {KINDS.find(k => k.key === p.kind)?.label} · {spiritLabel(p.spirit)}
              {p.kind !== 'botella' && ` · ${(p.ingredients ?? []).reduce((s, i) => s + i.ml, 0)} ml de licor`}
              {!p.active && ' · oculto'}
              <Pencil className="w-3 h-3 inline ml-2" />
            </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Licores
const ItemsTab: React.FC<{ event: EventLite; items: BarItem[]; reload: () => void }> = ({ event, items, reload }) => {
  const [form, setForm] = useState<Partial<BarItem> | null>(null);
  const [msg, setMsg] = useState('');
  const save = async () => {
    if (!form?.name?.trim()) return;
    const { error } = await supabase.rpc('bar_save_item', {
      p_event_id: event.id,
      p_id: form.id || null,
      p_name: form.name,
      p_spirit: form.spirit || 'otro',
      p_bottle_ml: Number(form.bottle_ml) || 750,
      p_bottle_price: form.bottle_price ? Number(form.bottle_price) : null,
      p_active: form.active ?? true,
    });
    if (error) setMsg(errText(error));
    else {
      setForm(null);
      setMsg('');
      reload();
    }
  };
  return (
    <div>
      <p className="text-sm text-cream/60 mb-3">
        Cada licor/botella que entra al evento (ej. "Jack Daniel's 750 ml"). Se usa para recetas, venta de botellas e inventario.
      </p>
      {form ? (
        <div className="card p-4 space-y-3 max-w-lg">
          <Field label="Nombre">
            <input className="input" value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Jack Daniel's 750 ml" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Licor">
              <select className="input" value={form.spirit ?? 'whisky'} onChange={e => setForm({ ...form, spirit: e.target.value })}>
                {SPIRITS.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ml por botella">
              <input
                className="input"
                inputMode="numeric"
                value={String(form.bottle_ml ?? 750)}
                onChange={e => setForm({ ...form, bottle_ml: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active ?? true} onChange={e => setForm({ ...form, active: e.target.checked })} /> Activo
          </label>
          {msg && <p className="text-sm text-red-300">{msg}</p>}
          <div className="flex gap-2">
            <button className="btn btn-gold" onClick={save}>
              <Save className="w-4 h-4" /> Guardar
            </button>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="btn btn-gold !py-2 mb-3" onClick={() => setForm({ spirit: 'whisky', bottle_ml: 750, active: true })}>
            <Plus className="w-4 h-4" /> Nuevo licor
          </button>
          <div className="grid sm:grid-cols-2 gap-2">
            {items.map(i => (
              <button key={i.id} className={`card p-3 text-left ${i.active ? '' : 'opacity-50'}`} onClick={() => setForm({ ...i })}>
                <p className="font-semibold">{i.name}</p>
                <p className="text-xs text-cream/50">
                  {spiritLabel(i.spirit)} · {i.bottle_ml} ml
                </p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Inventario
interface StockRow {
  itemId: string;
  name: string;
  bottleMl: number;
  pool: 'cocteleria' | 'venta';
  loadedBottles: number;
  transferBottles: number;
  soldBottles: number;
  usedMl: number;
  adjustBottles: number;
  adjustMl: number;
  expectedMl: number;
  lastCount: { bottles: number; ml: number; at: string } | null;
}

const bottles = (ml: number, per: number) => Math.round((ml / per) * 100) / 100;

const InventarioTab: React.FC<{ event: EventLite; items: BarItem[] }> = ({ event, items }) => {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [kind, setKind] = useState<'carga' | 'conteo' | 'ajuste'>('carga');
  const [itemId, setItemId] = useState('');
  const [pool, setPool] = useState<'cocteleria' | 'venta'>('cocteleria');
  const [qty, setQty] = useState('');
  const [ml, setMl] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc('bar_stock_report', { p_event_id: event.id });
    if (!error) setRows((data as StockRow[]) ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  const submit = async () => {
    if (!itemId) return setMsg({ ok: false, text: 'Elige el licor.' });
    const { error } = await supabase.rpc('bar_stock_move', {
      p_event_id: event.id,
      p_item_id: itemId,
      p_kind: kind,
      p_pool: pool,
      p_bottles: Number(qty) || 0,
      p_ml: Number(ml) || 0,
      p_note: note,
    });
    if (error) return setMsg({ ok: false, text: errText(error) });
    setMsg({ ok: true, text: 'Guardado.' });
    setQty('');
    setMl('');
    setNote('');
    load();
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ['carga', 'Cargar botellas'],
              ['conteo', 'Conteo de cierre'],
              ['ajuste', 'Ajuste'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`chip ${kind === k ? 'chip-on' : ''}`} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        <p className="text-xs text-cream/55">
          {kind === 'carga' && 'Botellas que entran. Elige si son para COCTELERÍA o para VENTA de botella entera.'}
          {kind === 'conteo' && 'Al cerrar: cuenta lo que queda (botellas llenas + ml sueltos de la abierta). Se compara con lo que debería haber.'}
          {kind === 'ajuste' && 'Corrección (rotura, cortesía, etc.). Usa números negativos para restar. El motivo es obligatorio.'}
        </p>
        <div className="grid sm:grid-cols-4 gap-2">
          <select className="input sm:col-span-2" value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="">— Licor —</option>
            {items.map(i => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <select className="input" value={pool} onChange={e => setPool(e.target.value as 'cocteleria' | 'venta')}>
            <option value="cocteleria">Cocteleria</option>
            <option value="venta">Venta de botella</option>
          </select>
          <input className="input" inputMode="decimal" placeholder="Botellas" value={qty} onChange={e => setQty(e.target.value.replace(/[^\d.-]/g, ''))} />
          {kind !== 'carga' && (
            <input className="input" inputMode="decimal" placeholder="ml sueltos" value={ml} onChange={e => setMl(e.target.value.replace(/[^\d.-]/g, ''))} />
          )}
          <input className="input sm:col-span-3" placeholder={kind === 'ajuste' ? 'Motivo (obligatorio)' : 'Nota (opcional)'} value={note} onChange={e => setNote(e.target.value)} />
        </div>
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
        <button className="btn btn-gold" onClick={submit}>
          <Save className="w-4 h-4" /> Guardar
        </button>
      </div>

      <div className="card p-4 overflow-x-auto">
        <div className="flex items-center justify-between mb-2">
          <p className="font-display text-lg">¿Cuadra el licor?</p>
          <button onClick={load} className="text-cream/50">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-cream/50">Aún no hay movimientos.</p>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-cream/50 text-left">
              <tr>
                <th className="py-1">Licor</th>
                <th>Grupo</th>
                <th>Entró</th>
                <th>Salió</th>
                <th>Debería quedar</th>
                <th>Conteo</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const counted = r.lastCount ? r.lastCount.bottles * r.bottleMl + Number(r.lastCount.ml) : null;
                const diff = counted == null ? null : counted - r.expectedMl;
                return (
                  <tr key={r.itemId + r.pool} className="border-t border-gold/10">
                    <td className="py-1.5">{r.name}</td>
                    <td>{r.pool === 'cocteleria' ? 'Cocteleria' : 'Venta'}</td>
                    <td>
                      {Number(r.loadedBottles) + Math.max(0, Number(r.transferBottles))} bot.
                    </td>
                    <td>
                      {r.pool === 'venta'
                        ? `${r.soldBottles} vendidas${Number(r.transferBottles) < 0 ? ` · ${-r.transferBottles} a coctel.` : ''}`
                        : `${r.usedMl} ml en tragos`}
                    </td>
                    <td className="text-gold-soft">
                      {bottles(r.expectedMl, r.bottleMl)} bot. ({Math.round(r.expectedMl)} ml)
                    </td>
                    <td>{counted == null ? '—' : `${bottles(counted, r.bottleMl)} bot.`}</td>
                    <td className={diff == null ? '' : Math.abs(diff) <= r.bottleMl * 0.05 ? 'text-emerald-300' : 'text-red-300 font-semibold'}>
                      {diff == null ? '—' : `${diff > 0 ? '+' : ''}${Math.round(diff)} ml`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-cream/40 mt-3">
          Verde: cuadra (±5% de una botella). Rojo: falta (negativo) o sobra licor respecto a lo vendido.
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Cierre
interface OrderRow {
  id: string;
  number: number;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
}

const CierreTab: React.FC<{ event: EventLite }> = ({ event }) => {
  const [data, setData] = useState<{
    byCashier: { cashier: string; method: string; orders: number; total: number }[];
    byProduct: { name: string; qty: number; total: number }[];
  }>({ byCashier: [], byProduct: [] });
  const [cash, setCash] = useState<{ cashier: string; people: number; total: number }[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const load = async () => {
    const [s, c, o] = await Promise.all([
      supabase.rpc('bar_sales_summary', { p_event_id: event.id }),
      supabase.rpc('cash_summary', { p_event_id: event.id, p_only_mine: false }),
      supabase.from('bar_orders').select('id, number, total, payment_method, status, created_at').eq('event_id', event.id).order('number', { ascending: false }).limit(40),
    ]);
    if (s.data) setData(s.data as typeof data);
    setCash(((c.data as typeof cash) ?? []).map(x => ({ ...x, total: Number(x.total) })));
    setOrders(((o.data as OrderRow[]) ?? []).map(x => ({ ...x, total: Number(x.total) })));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  const byMethod = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of data.byCashier) m[r.method] = (m[r.method] ?? 0) + Number(r.total);
    return m;
  }, [data]);
  const barTotal = Object.values(byMethod).reduce((a, b) => a + b, 0);
  const cashTickets = cash.reduce((s, r) => s + r.total, 0);

  const voidOrder = async (o: OrderRow) => {
    const reason = prompt(`Anular pedido #${o.number} (${money(o.total, event.currency)}). Motivo:`);
    if (!reason) return;
    const { error } = await supabase.rpc('bar_void_order', { p_order_id: o.id, p_note: reason });
    if (error) alert(errText(error));
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={load} className="chip">
          <RefreshCw className="w-4 h-4 inline" /> Actualizar
        </button>
      </div>
      <div className="grid sm:grid-cols-4 gap-2">
        {(['efectivo', 'transferencia', 'deuna'] as const).map(m => (
          <div key={m} className="card p-3">
            <p className="text-xs text-cream/50">Barra · {PAY_LABEL[m]}</p>
            <p className="font-display text-2xl text-gold-soft">{money(byMethod[m] ?? 0, event.currency)}</p>
          </div>
        ))}
        <div className="card p-3 border-gold/50">
          <p className="text-xs text-cream/50">Total barra</p>
          <p className="font-display text-2xl">{money(barTotal, event.currency)}</p>
        </div>
      </div>

      <div className="card p-4">
        <p className="font-display text-lg mb-2">Efectivo que debe entregar cada cajero</p>
        {data.byCashier.filter(r => r.method === 'efectivo').length === 0 && <p className="text-sm text-cream/50">Sin ventas en efectivo.</p>}
        {data.byCashier
          .filter(r => r.method === 'efectivo')
          .map(r => (
            <div key={r.cashier} className="flex justify-between text-sm py-1 border-b border-gold/10">
              <span>
                {r.cashier} · {r.orders} pedidos
              </span>
              <span className="text-gold-soft">{money(Number(r.total), event.currency)}</span>
            </div>
          ))}
      </div>

      <div className="card p-4">
        <p className="font-display text-lg mb-2">Lo más vendido</p>
        {[...data.byProduct]
          .sort((a, b) => Number(b.qty) - Number(a.qty))
          .map(p => (
            <div key={p.name} className="flex justify-between text-sm py-1 border-b border-gold/10">
              <span>
                {p.qty}× {p.name}
              </span>
              <span>{money(Number(p.total), event.currency)}</span>
            </div>
          ))}
      </div>

      <div className="card p-4">
        <p className="font-display text-lg mb-2">Caja de entradas (efectivo)</p>
        {cash.length === 0 && <p className="text-sm text-cream/50">Sin cobros de entradas en efectivo.</p>}
        {cash.map(r => (
          <div key={r.cashier} className="flex justify-between text-sm py-1 border-b border-gold/10">
            <span>
              {r.cashier} · {r.people} entradas
            </span>
            <span className="text-gold-soft">{money(r.total, event.currency)}</span>
          </div>
        ))}
        {cash.length > 0 && <p className="text-right text-sm mt-2">Total: {money(cashTickets, event.currency)}</p>}
      </div>

      <div className="card p-4">
        <p className="font-display text-lg mb-2">Últimos pedidos</p>
        {orders.map(o => (
          <div key={o.id} className={`flex items-center justify-between text-sm py-1.5 border-b border-gold/10 ${o.status === 'anulado' ? 'opacity-40 line-through' : ''}`}>
            <span>
              #{o.number} · {PAY_LABEL[o.payment_method]} · {new Date(o.created_at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })} ·{' '}
              {o.status}
            </span>
            <span className="flex items-center gap-2">
              {money(o.total, event.currency)}
              {o.status !== 'anulado' && (
                <button onClick={() => voidOrder(o)} className="text-cream/40 hover:text-red-300" aria-label="Anular">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Personal
const PersonalTab: React.FC<{ event: EventLite }> = ({ event }) => {
  const [list, setList] = useState<{ email: string; name: string; role: string; eventId: string | null }[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('cajero_barra');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => supabase.rpc('staff_list', { p_event_id: event.id }).then(({ data }) => setList((data as typeof list) ?? []));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  const setRoleFor = async (mail: string, r: string, enabled: boolean, evId: string | null) => {
    const { error } = await supabase.rpc('staff_set_role', { p_email: mail, p_role: r, p_event_id: evId, p_enabled: enabled });
    if (error) setMsg({ ok: false, text: errText(error) });
    else {
      setMsg({ ok: true, text: enabled ? 'Permiso dado.' : 'Permiso quitado.' });
      load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3 max-w-xl">
        <p className="text-sm text-cream/60">
          1) Crea la cuenta en King → Usuarios → Crear (rol "Staff de puerta"). 2) Aquí le das el permiso con su correo.
        </p>
        <input className="input" placeholder="Correo de la persona" value={email} onChange={e => setEmail(e.target.value.trim())} />
        <select className="input" value={role} onChange={e => setRole(e.target.value)}>
          {Object.entries(ROLE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
        <button className="btn btn-gold" disabled={!email} onClick={() => setRoleFor(email, role, true, event.id)}>
          <Plus className="w-4 h-4" /> Dar permiso en {event.city}
        </button>
      </div>
      <div className="card p-4">
        <p className="font-display text-lg mb-2">Personal de {event.city}</p>
        {list.length === 0 && <p className="text-sm text-cream/50">Nadie asignado todavía.</p>}
        {list.map(s => (
          <div key={s.email + s.role} className="flex items-center justify-between text-sm py-1.5 border-b border-gold/10">
            <span>
              {s.name} <span className="text-cream/50">({s.email})</span> · {ROLE_LABEL[s.role]}
            </span>
            <button
              className="text-cream/40 hover:text-red-300"
              onClick={() => confirm(`¿Quitar a ${s.name} de ${ROLE_LABEL[s.role]}?`) && setRoleFor(s.email, s.role, false, s.eventId)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
