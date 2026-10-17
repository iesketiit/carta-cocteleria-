import React, { useCallback, useEffect, useState } from 'react';
import { Banknote, QrCode, Undo2, ChevronDown } from 'lucide-react';
import { supabase, errText } from '../lib/supabase';
import { money, PAY_LABEL } from '../lib/format';

interface MyOrder {
  id: string;
  number: number;
  total: number;
  payment_method: string;
  status: string;
  synced_at: string;
  items: { name: string; qty: number }[];
}

interface Props {
  eventId: string;
  currency: string;
  online: boolean;
  pendingCount: number;
}

// Caja del cajero de barra: cuánto debe tener en cada forma de pago y sus
// últimos pedidos, con "Anular" si se equivocó.
export const MiCaja: React.FC<Props> = ({ eventId, currency, online, pendingCount }) => {
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid || !eventId) return;
    const { data, error } = await supabase
      .from('bar_orders')
      .select('id, number, total, payment_method, status, synced_at, bar_order_items(name, qty)')
      .eq('event_id', eventId)
      .eq('cashier_id', uid)
      .order('number', { ascending: false })
      .limit(300);
    if (error) return;
    const rows = ((data ?? []) as unknown as (Omit<MyOrder, 'items' | 'total'> & { total: number | string; bar_order_items: MyOrder['items'] })[]).map(r => ({
      ...r,
      total: Number(r.total),
      items: r.bar_order_items ?? [],
    }));
    const t: Record<string, number> = {};
    let n = 0;
    for (const r of rows) {
      if (r.status === 'anulado') continue;
      t[r.payment_method] = (t[r.payment_method] ?? 0) + r.total;
      n += 1;
    }
    setTotals(t);
    setCount(n);
    setOrders(rows.slice(0, 12));
  }, [eventId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    const clock = setInterval(() => tick(x => x + 1), 30000);
    window.addEventListener('403-synced', load);
    return () => {
      clearInterval(t);
      clearInterval(clock);
      window.removeEventListener('403-synced', load);
    };
  }, [load]);

  const canVoid = (o: MyOrder) => o.status !== 'anulado';

  const voidIt = async (o: MyOrder) => {
    if (!confirm(`¿Anular el pedido #${o.number} (${money(o.total, currency)})? Se descuenta de tu caja y queda registrado como anulado.`)) return;
    setBusy(o.id);
    setMsg('');
    const { error } = await supabase.rpc('bar_cashier_void', { p_order_id: o.id, p_note: 'Anulado por el cajero' });
    setBusy('');
    if (error) setMsg(errText(error));
    window.dispatchEvent(new Event('403-levels'));
    load();
  };

  const cash = totals.efectivo ?? 0;
  const digital = (totals.transferencia ?? 0) + (totals.deuna ?? 0);
  const all = cash + digital;

  return (
    <div className="mt-4 pt-4 border-t border-gold/20">
      <p className="font-display text-lg mb-2">Mi caja</p>
      <div className="rounded-xl border border-gold/40 bg-black/40 p-3">
        <p className="text-xs text-cream/60 flex items-center gap-1">
          <Banknote className="w-3.5 h-3.5 text-emerald-300" /> Efectivo que debes tener
        </p>
        <p className="font-display text-3xl text-gold-soft leading-tight">{money(cash, currency)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
        <div className="rounded-lg bg-black/30 p-2">
          <p className="text-[11px] text-cream/50 flex items-center gap-1">
            <QrCode className="w-3 h-3 text-purple-300" /> {PAY_LABEL.transferencia} / {PAY_LABEL.deuna}
          </p>
          <p>{money(digital, currency)}</p>
          <p className="text-[10px] text-cream/40">debe estar en la cuenta</p>
        </div>
        <div className="rounded-lg bg-black/30 p-2">
          <p className="text-[11px] text-cream/50">Total vendido</p>
          <p>{money(all, currency)}</p>
          <p className="text-[10px] text-cream/40">{count} pedidos</p>
        </div>
      </div>
      {pendingCount > 0 && <p className="text-[11px] text-amber-300 mt-2">Hay {pendingCount} pedido(s) por enviar: aún no suman aquí.</p>}
      {!online && <p className="text-[11px] text-cream/40 mt-1">Sin señal: se actualiza al volver.</p>}

      <button className="mt-3 w-full flex items-center justify-between text-xs text-cream/70" onClick={() => setOpen(o => !o)}>
        <span>Mis últimos pedidos (borrar si te equivocaste)</span>
        <ChevronDown className={`w-4 h-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {msg && <p className="text-xs text-red-300">{msg}</p>}
          {orders.length === 0 && <p className="text-xs text-cream/40">Aún no has vendido.</p>}
          {orders.map(o => (
            <div key={o.id} className={`rounded-lg bg-black/30 p-2 text-xs ${o.status === 'anulado' ? 'opacity-40' : ''}`}>
              <div className="flex justify-between gap-2">
                <span className={o.status === 'anulado' ? 'line-through' : ''}>
                  #{o.number} · {PAY_LABEL[o.payment_method] ?? o.payment_method}
                </span>
                <span className="text-gold-soft">{money(o.total, currency)}</span>
              </div>
              <p className="text-cream/50 truncate">{o.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-cream/40">
                  {o.status === 'anulado' ? 'Anulado' : o.status === 'entregado' ? 'Ya entregado' : 'Pendiente de entregar'}
                </span>
                {canVoid(o) && (
                  <button
                    disabled={busy === o.id || !online}
                    onClick={() => voidIt(o)}
                    className="flex items-center gap-1 text-red-300 underline disabled:opacity-40"
                  >
                    <Undo2 className="w-3 h-3" /> Borrar
                  </button>
                )}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-cream/40">Al anular, el pedido sale de tu caja. El administrador lo ve en el cierre como anulado.</p>
        </div>
      )}
    </div>
  );
};
