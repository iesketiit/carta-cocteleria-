import React, { useEffect, useMemo, useState } from 'react';
import { Search, CheckCircle2, UserRound, Banknote, RefreshCw } from 'lucide-react';
import { Shell } from '../components/Shell';
import { supabase, errText } from '../lib/supabase';
import { EventLite } from '../lib/types';
import { money } from '../lib/format';

interface Props {
  event: EventLite;
  events: EventLite[];
  eventId: string;
  onEvent: (id: string) => void;
  online: boolean;
  onBack: () => void;
}

interface Person {
  userId: string | null;
  name: string;
  email: string;
  phone: string | null;
  hasAccount: boolean;
  tickets: number;
}

interface Tier {
  id: string;
  name: string;
  price: number;
  isGroupTier?: boolean;
  groupSize?: number;
  soldOut?: boolean;
}

interface Summary {
  cashier: string;
  sales: number;
  people: number;
  total: number;
  today: number | null;
}

// Cobro en EFECTIVO de entradas a personas ya aprobadas. La entrada (con QR)
// le aparece en su cuenta al instante. Queda registrado quién cobró.
export const Caja: React.FC<Props> = ({ event, events, eventId, onEvent, online, onBack }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tierId, setTierId] = useState('');
  const [qty, setQty] = useState(1);
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ name: string; tier: string; people: number; total: number } | null>(null);
  const [summary, setSummary] = useState<Summary[]>([]);

  const loadSummary = () =>
    supabase.rpc('cash_summary', { p_event_id: event.id, p_only_mine: true }).then(({ data }) => setSummary((data as Summary[]) ?? []));

  useEffect(() => {
    supabase
      .from('events')
      .select('ticket_tiers')
      .eq('id', event.id)
      .maybeSingle()
      .then(({ data }) => setTiers(((data?.ticket_tiers as Tier[]) ?? []).map(t => ({ ...t, price: Number(t.price) || 0 }))));
    loadSummary();
    setPerson(null);
    setResults([]);
    setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase.rpc('cash_search_people', { p_event_id: event.id, p_query: q });
      setSearching(false);
      if (error) setError(errText(error));
      else setResults((data as Person[]) ?? []);
    }, 350);
    return () => clearTimeout(t);
  }, [query, event.id]);

  const tier = tiers.find(t => t.id === tierId);
  const isPalco = !!tier?.isGroupTier;
  const people = isPalco ? tier?.groupSize || 1 : qty;
  const total = tier ? (isPalco ? tier.price : tier.price * qty) : 0;
  const receivedNum = Number(received.replace(',', '.')) || 0;
  const change = receivedNum - total;

  const pick = (p: Person) => {
    setPerson(p);
    setTierId('');
    setQty(1);
    setReceived('');
    setError('');
  };

  const sell = async () => {
    if (!person?.userId || !tier) return;
    if (received && change < 0) {
      setError('El dinero recibido no alcanza.');
      return;
    }
    if (
      !confirm(
        `¿Cobrar ${money(total, event.currency)} en EFECTIVO a ${person.name}?\n\n${tier.name}${
          isPalco ? ` (palco, ${people} personas)` : ` × ${qty}`
        }`
      )
    )
      return;
    setBusy(true);
    setError('');
    const { data, error } = await supabase.rpc('cash_sell_ticket', {
      p_user_id: person.userId,
      p_event_id: event.id,
      p_tier_id: tier.id,
      p_quantity: isPalco ? 1 : qty,
      p_note: 'Efectivo · caja',
    });
    setBusy(false);
    if (error) {
      setError(errText(error));
      return;
    }
    const r = data as { people: number; total: number; tierName: string };
    setDone({ name: person.name, tier: r.tierName, people: r.people, total: r.total });
    setPerson(null);
    setQuery('');
    setResults([]);
    loadSummary();
  };

  const mine = useMemo(() => summary.reduce((s, r) => s + Number(r.total || 0), 0), [summary]);

  return (
    <Shell title="Caja de entradas" events={events} eventId={eventId} onEvent={onEvent} online={online} onBack={onBack}>
      {!online && (
        <div className="card p-3 mb-4 border-red-400/40 text-sm text-red-200">
          Sin señal: para cobrar entradas se necesita internet (la entrada se crea en el sistema al instante).
        </div>
      )}

      {done && (
        <div className="card p-5 mb-4 border-emerald-500/40">
          <p className="flex items-center gap-2 text-emerald-300 font-semibold">
            <CheckCircle2 className="w-5 h-5" /> Cobrado {money(done.total, event.currency)}
          </p>
          <p className="text-sm text-cream/70 mt-1">
            {done.name} · {done.tier} · {done.people} {done.people === 1 ? 'entrada' : 'entradas'} con QR. Ya le aparecen en su
            cuenta de 403events.com.
          </p>
          <button className="btn btn-ghost mt-3" onClick={() => setDone(null)}>
            Nueva venta
          </button>
        </div>
      )}

      {!person && !done && (
        <div className="card p-4">
          <label className="text-xs text-cream/60">Busca a la persona aprobada (nombre, correo o teléfono)</label>
          <div className="relative mt-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gold" />
            <input className="input !pl-9" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ej. Ana Pérez" autoFocus />
          </div>
          {searching && <p className="text-xs text-cream/50 mt-3">Buscando…</p>}
          {!searching && query.trim().length >= 3 && results.length === 0 && (
            <p className="text-xs text-cream/50 mt-3">
              No aparece. Solo se puede cobrar a personas aprobadas para {event.city}. Si no tiene solicitud, que la haga en
              403events.com.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {results.map(p => (
              <button
                key={p.email}
                onClick={() => pick(p)}
                disabled={!p.hasAccount}
                className="w-full text-left p-3 rounded-xl border border-gold/20 hover:border-gold/60 bg-black/40 disabled:opacity-50"
              >
                <p className="flex items-center gap-2 font-semibold">
                  <UserRound className="w-4 h-4 text-gold" /> {p.name}
                </p>
                <p className="text-xs text-cream/55 mt-0.5">
                  {p.email}
                  {p.phone ? ` · ${p.phone}` : ''}
                  {p.tickets > 0 ? ` · ya tiene ${p.tickets} entrada(s)` : ''}
                  {!p.hasAccount ? ' · sin cuenta todavía' : ''}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {person && (
        <div className="card p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-xl">{person.name}</p>
              <p className="text-xs text-cream/55">{person.email}</p>
            </div>
            <button className="btn btn-ghost !py-2 text-sm" onClick={() => setPerson(null)}>
              Cambiar
            </button>
          </div>

          <div>
            <p className="text-xs text-cream/60 mb-2">Localidad</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tiers.map(t => (
                <button
                  key={t.id}
                  disabled={t.soldOut}
                  onClick={() => {
                    setTierId(t.id);
                    setQty(1);
                  }}
                  className={`p-3 rounded-xl border text-left ${
                    tierId === t.id ? 'border-gold bg-wine/40' : 'border-gold/20 bg-black/40'
                  } disabled:opacity-40`}
                >
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-gold-soft">
                    {money(t.price, event.currency)}
                    {t.isGroupTier ? ` · palco ${t.groupSize} personas` : ' por persona'}
                    {t.soldOut ? ' · AGOTADA' : ''}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {tier && !isPalco && (
            <div>
              <p className="text-xs text-cream/60 mb-2">Cantidad de entradas</p>
              <div className="flex gap-2 flex-wrap">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setQty(n)} className={`chip ${qty === n ? 'chip-on' : ''}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tier && (
            <div className="p-4 rounded-xl bg-black/50 border border-gold/20 space-y-3">
              <div className="flex justify-between text-lg">
                <span>Total</span>
                <span className="font-display text-gold-soft">{money(total, event.currency)}</span>
              </div>
              <div>
                <label className="text-xs text-cream/60">Recibí (opcional, para calcular el cambio)</label>
                <input
                  className="input mt-1"
                  inputMode="decimal"
                  value={received}
                  onChange={e => setReceived(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="Ej. 20"
                />
                {received && (
                  <p className={`text-sm mt-2 ${change < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {change < 0 ? `Faltan ${money(-change, event.currency)}` : `Cambio: ${money(change, event.currency)}`}
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-red-300">{error}</p>}
              <button className="btn btn-gold w-full text-lg" disabled={busy || !online} onClick={sell}>
                <Banknote className="w-5 h-5" />
                {busy ? 'Cobrando…' : `Cobrar ${money(total, event.currency)} en efectivo`}
              </button>
            </div>
          )}
        </div>
      )}

      {error && !person && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <div className="card p-4 mt-5">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg">Mi caja</p>
          <button onClick={loadSummary} className="text-cream/50 hover:text-cream" aria-label="Actualizar">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {summary.length === 0 ? (
          <p className="text-sm text-cream/50 mt-2">Todavía no hay cobros en efectivo.</p>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            {summary.map(s => (
              <div key={s.cashier} className="flex justify-between">
                <span>
                  {s.cashier} · {s.people} entradas
                </span>
                <span className="text-gold-soft">
                  {money(Number(s.total), event.currency)}
                  {s.today != null ? ` (hoy ${money(Number(s.today), event.currency)})` : ''}
                </span>
              </div>
            ))}
            {summary.length > 1 && (
              <div className="flex justify-between border-t border-gold/20 pt-1 font-semibold">
                <span>Total</span>
                <span>{money(mine, event.currency)}</span>
              </div>
            )}
          </div>
        )}
        <p className="text-[11px] text-cream/40 mt-3">Al cerrar, el efectivo físico debe coincidir con este total.</p>
      </div>
    </Shell>
  );
};
