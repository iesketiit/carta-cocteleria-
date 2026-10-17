import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, CheckCircle2, UserRound, Banknote, RefreshCw, Undo2 } from 'lucide-react';
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
  id: string;
  name: string;
  instagram: string;
  phone: string;
  status: 'accepted' | 'paid';
  tierName: string | null;
  amount: number | null;
  paidAt: string | null;
  paidByMe: boolean;
  canUndo: boolean;
}

interface Tier {
  id: string;
  name: string;
  price: number;
  isGroupTier?: boolean;
  soldOut?: boolean;
}

interface Summary {
  cashier: string;
  sales: number;
  total: number;
}

// Cobro en EFECTIVO a las personas que el curador aceptó en /envivo. Solo se
// ven aceptados y cobrados. Para cobrar, la persona dice su radicado (el que
// le llegó por WhatsApp) y la caja lo escribe: si no coincide, no se cobra.
export const Cobrar: React.FC<Props> = ({ event, events, eventId, onEvent, online, onBack }) => {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tierId, setTierId] = useState('');
  const [radicado, setRadicado] = useState('');
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ name: string; tier: string; amount: number } | null>(null);
  const [summary, setSummary] = useState<Summary[]>([]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const search = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('envivo_cash_search', {
      p_event_id: event.id,
      p_query: queryRef.current.trim(),
    });
    if (err) setError(errText(err));
    else {
      setPeople((data as Person[]) ?? []);
      setLoaded(true);
    }
  }, [event.id]);

  const loadSummary = useCallback(
    () => supabase.rpc('envivo_cash_summary', { p_event_id: event.id, p_only_mine: true }).then(({ data }) => setSummary((data as Summary[]) ?? [])),
    [event.id]
  );

  useEffect(() => {
    supabase
      .from('events')
      .select('ticket_tiers')
      .eq('id', event.id)
      .maybeSingle()
      .then(({ data }) =>
        setTiers(
          ((data?.ticket_tiers as Tier[]) ?? [])
            .filter(t => !t.isGroupTier)
            .map(t => ({ ...t, price: Number(t.price) || 0 }))
        )
      );
    loadSummary();
    setSelectedId(null);
    setLoaded(false);
  }, [event.id, loadSummary]);

  // Búsqueda al escribir + refresco cada 5 s (llegan aceptados nuevos).
  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [query, search]);
  useEffect(() => {
    const t = setInterval(search, 5000);
    return () => clearInterval(t);
  }, [search]);

  const selected = people.find(p => p.id === selectedId) ?? null;
  const tier = tiers.find(t => t.id === tierId);
  const total = tier?.price ?? 0;
  const receivedNum = Number(received.replace(',', '.')) || 0;
  const change = receivedNum - total;

  const pick = (p: Person) => {
    setSelectedId(p.id);
    setTierId(tiers.length === 1 && !tiers[0].soldOut ? tiers[0].id : '');
    setRadicado('');
    setReceived('');
    setError('');
  };

  const pay = async () => {
    if (!selected || !tier) return;
    if (radicado.replace(/\D/g, '').length !== 6) return setError('Escribe el radicado de 6 dígitos que te muestra la persona.');
    if (received && change < 0) return setError('El dinero recibido no alcanza.');
    if (!confirm(`¿Cobrar ${money(total, event.currency)} en EFECTIVO a ${selected.name}?\n\n${tier.name}\n\nRevisa que la cédula sea de esta persona.`)) return;
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('envivo_cash_pay', {
      p_id: selected.id,
      p_tier_id: tier.id,
      p_radicado: radicado,
    });
    setBusy(false);
    if (err) {
      setError(errText(err));
      return;
    }
    const r = data as { name: string; tierName: string; amount: number };
    setDone({ name: r.name, tier: r.tierName, amount: r.amount });
    setSelectedId(null);
    setQuery('');
    search();
    loadSummary();
  };

  const undo = async (p: Person) => {
    if (!confirm(`¿Deshacer el cobro de ${p.name}? Vuelve a quedar como "Aceptado" y sin cobrar.`)) return;
    const { error: err } = await supabase.rpc('envivo_cash_undo', { p_id: p.id });
    if (err) setError(errText(err));
    else {
      setError('');
      search();
      loadSummary();
    }
  };

  const mineTotal = useMemo(() => summary.reduce((s, r) => s + Number(r.total || 0), 0), [summary]);

  return (
    <Shell title="Cobrar en vivo" events={events} eventId={eventId} onEvent={onEvent} online={online} onBack={onBack}>
      {!online && <div className="card p-3 mb-4 border-red-400/40 text-sm text-red-200">Sin señal: para cobrar se necesita internet.</div>}

      {done && (
        <div className="card p-5 mb-4 border-emerald-500/40">
          <p className="flex items-center gap-2 text-emerald-300 font-semibold">
            <CheckCircle2 className="w-5 h-5" /> Cobrado {money(done.amount, event.currency)}
          </p>
          <p className="text-sm text-cream/70 mt-1">
            {done.name} · {done.tier}. Ya puede pasar.
          </p>
          <button className="btn btn-ghost mt-3" onClick={() => setDone(null)}>
            Siguiente
          </button>
        </div>
      )}

      {!selected && !done && (
        <div className="card p-4">
          <label className="text-xs text-cream/60">Busca por nombre, Instagram, número o radicado</label>
          <div className="relative mt-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gold" />
            <input
              className="input !pl-9"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ej. Ana, @ana, 0991234567 o 482913"
              autoFocus
            />
          </div>

          {loaded && people.length === 0 && (
            <p className="text-xs text-cream/50 mt-3">
              {query.trim() ? 'No aparece entre los aceptados. Solo se cobra a quien el curador aceptó.' : 'Todavía no hay aceptados.'}
            </p>
          )}

          <div className="mt-3 space-y-2">
            {people.map(p => (
              <div key={p.id} className={`p-3 rounded-xl border bg-black/40 ${p.status === 'paid' ? 'border-emerald-500/30' : 'border-gold/20'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      <UserRound className="w-4 h-4 text-gold shrink-0" /> <span className="truncate">{p.name}</span>
                    </p>
                    <p className="text-xs text-cream/55 mt-0.5">
                      @{p.instagram} · +{p.phone}
                    </p>
                    {p.status === 'paid' && (
                      <p className="text-xs text-emerald-300 mt-1">
                        ✓ Cobrado{p.amount != null ? ` ${money(p.amount, event.currency)}` : ''}
                        {p.tierName ? ` · ${p.tierName}` : ''}
                      </p>
                    )}
                  </div>
                  {p.status === 'accepted' ? (
                    <button className="btn btn-gold !py-2 shrink-0" onClick={() => pick(p)}>
                      Cobrar
                    </button>
                  ) : (
                    p.canUndo && (
                      <button className="btn btn-ghost !py-2 shrink-0 text-sm" onClick={() => undo(p)}>
                        <Undo2 className="w-4 h-4" /> Deshacer
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
        </div>
      )}

      {selected && (
        <div className="card p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-xl">{selected.name}</p>
              <p className="text-xs text-cream/55">
                @{selected.instagram} · +{selected.phone}
              </p>
            </div>
            <button className="btn btn-ghost !py-2 text-sm" onClick={() => setSelectedId(null)}>
              Volver
            </button>
          </div>

          <div>
            <label className="text-xs text-cream/60">Radicado que muestra la persona (6 dígitos)</label>
            <input
              className="input mt-1 text-xl tracking-[0.4em] text-center"
              inputMode="numeric"
              maxLength={6}
              value={radicado}
              onChange={e => setRadicado(e.target.value.replace(/\D/g, ''))}
              placeholder="······"
              autoFocus
            />
          </div>

          <div>
            <p className="text-xs text-cream/60 mb-2">Localidad</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tiers.map(t => (
                <button
                  key={t.id}
                  disabled={t.soldOut}
                  onClick={() => setTierId(t.id)}
                  className={`p-3 rounded-xl border text-left ${tierId === t.id ? 'border-gold bg-wine/40' : 'border-gold/20 bg-black/40'} disabled:opacity-40`}
                >
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-gold-soft">
                    {money(t.price, event.currency)}
                    {t.soldOut ? ' · AGOTADA' : ''}
                  </p>
                </button>
              ))}
              {tiers.length === 0 && <p className="text-sm text-cream/50">Esta ciudad no tiene localidades para cobrar.</p>}
            </div>
          </div>

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
              <button className="btn btn-gold w-full text-lg" disabled={busy || !online} onClick={pay}>
                <Banknote className="w-5 h-5" />
                {busy ? 'Cobrando…' : `Cobrar ${money(total, event.currency)} en efectivo`}
              </button>
            </div>
          )}
          {!tier && error && <p className="text-sm text-red-300">{error}</p>}
        </div>
      )}

      <div className="card p-4 mt-5">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg">Mi caja (en vivo)</p>
          <button onClick={loadSummary} className="text-cream/50 hover:text-cream" aria-label="Actualizar">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {summary.length === 0 ? (
          <p className="text-sm text-cream/50 mt-2">Todavía no hay cobros.</p>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            {summary.map(s => (
              <div key={s.cashier} className="flex justify-between">
                <span>
                  {s.cashier} · {s.sales} {s.sales === 1 ? 'entrada' : 'entradas'}
                </span>
                <span className="text-gold-soft">{money(Number(s.total), event.currency)}</span>
              </div>
            ))}
            {summary.length > 1 && (
              <div className="flex justify-between border-t border-gold/20 pt-1 font-semibold">
                <span>Total</span>
                <span>{money(mineTotal, event.currency)}</span>
              </div>
            )}
          </div>
        )}
        <p className="text-[11px] text-cream/40 mt-3">Al cerrar, el efectivo físico debe coincidir con este total.</p>
      </div>
    </Shell>
  );
};
