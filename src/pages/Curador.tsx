import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X, ExternalLink, Radio, MessageCircle, RefreshCw } from 'lucide-react';
import { Shell } from '../components/Shell';
import { supabase, errText } from '../lib/supabase';
import { EventLite } from '../lib/types';

interface Props {
  event: EventLite;
  events: EventLite[];
  eventId: string;
  onEvent: (id: string) => void;
  online: boolean;
  onBack: () => void;
}

interface Pending {
  id: string;
  name: string;
  instagram: string;
  phone: string;
  createdAt: string;
}

interface Queue {
  open: boolean;
  pending: Pending[];
  counts: { pending: number; accepted: number; rejected: number; paid: number };
}

// Una decisión ya tomada, para poder reenviar el WhatsApp si falló.
interface Decided {
  id: string;
  name: string;
  phone: string;
  accepted: boolean;
  radicado: string | null;
  wa: 'sending' | 'ok' | 'error';
  waError?: string;
}

const POLL_MS = 3000;

const ago = (iso: string): string => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`;
};

// Respaldo si el bot falla: escribirle a mano desde el WhatsApp del curador.
const manualLink = (d: Decided): string => {
  const n = d.name.trim().split(/\s+/)[0] || '';
  const text = d.accepted
    ? `Hola ${n}, soy 403. 🖤 Tu solicitud fue aceptada. Tu radicado es: ${d.radicado}. Acércate a caja, di tu radicado y compra tu entrada en efectivo. Lleva tu cédula. No lo compartas.`
    : `Hola ${n}, soy 403. Revisamos tu solicitud y esta vez no pudo ser aprobada. Gracias por querer ser parte.`;
  return `https://wa.me/${d.phone}?text=${encodeURIComponent(text)}`;
};

// Curaduría en vivo: llegan las solicitudes de 403events.com/envivo, el
// curador abre el IG, acepta o rechaza. Al aceptar se crea el radicado y el
// bot se lo manda por WhatsApp.
export const Curador: React.FC<Props> = ({ event, events, eventId, onEvent, online, onBack }) => {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decided, setDecided] = useState<Decided[]>([]);
  const [, tick] = useState(0);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('envivo_queue', { p_event_id: event.id });
    if (err) {
      setError(errText(err));
      return;
    }
    setError('');
    const q = data as Queue;
    // Aviso al llegar una solicitud nueva.
    if (q.pending.length > lastCount.current) {
      try {
        navigator.vibrate?.(120);
      } catch {
        /* ignorar */
      }
    }
    lastCount.current = q.pending.length;
    setQueue(q);
  }, [event.id]);

  useEffect(() => {
    setQueue(null);
    lastCount.current = 0;
    load();
    const t = setInterval(load, POLL_MS);
    const clock = setInterval(() => tick(n => n + 1), 15000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [load]);

  const toggleOpen = async () => {
    if (!queue) return;
    const next = !queue.open;
    if (!next && !confirm('¿Cerrar /envivo? Nadie podrá enviar solicitudes nuevas.')) return;
    const { error: err } = await supabase.rpc('envivo_set_open', { p_event_id: event.id, p_open: next });
    if (err) setError(errText(err));
    else load();
  };

  const notify = async (id: string) => {
    setDecided(list => list.map(d => (d.id === id ? { ...d, wa: 'sending', waError: undefined } : d)));
    const { data, error: err } = await supabase.functions.invoke('envivo-notify', { body: { id } });
    // Si la función responde con error (502, 403…), supabase-js solo dice
    // "non-2xx": se lee el cuerpo para mostrar el motivo real.
    let detail = (data as { error?: string } | null)?.error || '';
    if (err && !detail) {
      try {
        const body = await (err as { context?: Response }).context?.json();
        detail = body?.error || '';
      } catch {
        /* sin cuerpo legible */
      }
    }
    const failed = err || detail;
    setDecided(list =>
      list.map(d =>
        d.id === id ? { ...d, wa: failed ? 'error' : 'ok', waError: failed ? detail || err?.message || 'No se pudo enviar.' : undefined } : d
      )
    );
  };

  const decide = async (p: Pending, accept: boolean) => {
    if (busyId) return;
    if (!accept && !confirm(`¿Rechazar a ${p.name}?`)) return;
    setBusyId(p.id);
    const { data, error: err } = await supabase.rpc('envivo_decide', { p_id: p.id, p_accept: accept });
    setBusyId(null);
    if (err) {
      setError(errText(err));
      load();
      return;
    }
    const res = data as { radicado: string | null };
    // Sale de la cola al instante.
    setQueue(q => (q ? { ...q, pending: q.pending.filter(x => x.id !== p.id) } : q));
    setDecided(list =>
      [{ id: p.id, name: p.name, phone: p.phone, accepted: accept, radicado: res.radicado, wa: 'sending' as const }, ...list].slice(0, 12)
    );
    notify(p.id);
    load();
  };

  return (
    <Shell title="Curaduría en vivo" events={events} eventId={eventId} onEvent={onEvent} online={online} onBack={onBack}>
      {!online && (
        <div className="card p-3 mb-4 border-red-400/40 text-sm text-red-200">Sin señal: la cola se actualiza cuando vuelva el internet.</div>
      )}

      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Radio className={`w-5 h-5 ${queue?.open ? 'text-emerald-300' : 'text-cream/40'}`} />
          <div>
            <p className="font-semibold">{queue?.open ? '/envivo está ABIERTO' : '/envivo está cerrado'}</p>
            <p className="text-xs text-cream/55">403events.com/envivo · {event.city}</p>
          </div>
        </div>
        <button className={`btn ${queue?.open ? 'btn-ghost' : 'btn-gold'}`} onClick={toggleOpen} disabled={!queue}>
          {queue?.open ? 'Cerrar' : 'Abrir ahora'}
        </button>
      </div>

      {queue && (
        <div className="grid grid-cols-4 gap-2 mb-4 text-center">
          {[
            ['Por revisar', queue.counts.pending],
            ['Aceptados', queue.counts.accepted],
            ['Cobrados', queue.counts.paid],
            ['Rechazados', queue.counts.rejected],
          ].map(([label, n]) => (
            <div key={label as string} className="card py-2">
              <p className="font-display text-xl text-gold-soft">{n as number}</p>
              <p className="text-[10px] text-cream/55">{label}</p>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-300 mb-3">{error}</p>}

      {!queue ? (
        <p className="text-sm text-cream/50">Cargando…</p>
      ) : queue.pending.length === 0 ? (
        <div className="card p-6 text-center text-cream/60">
          <RefreshCw className="w-5 h-5 mx-auto mb-2 text-gold" />
          <p>Sin solicitudes por revisar. Llegan aquí solas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.pending.map(p => (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-xl leading-tight break-words">{p.name}</p>
                  <p className="text-xs text-cream/50 mt-1">
                    {ago(p.createdAt)} · +{p.phone}
                  </p>
                </div>
                <a
                  href={`https://www.instagram.com/${encodeURIComponent(p.instagram)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost !py-2 shrink-0 text-sm"
                >
                  @{p.instagram} <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button className="btn btn-ghost !py-3" disabled={!!busyId || !online} onClick={() => decide(p, false)}>
                  <X className="w-5 h-5" /> Rechazar
                </button>
                <button className="btn btn-gold !py-3 text-lg" disabled={!!busyId || !online} onClick={() => decide(p, true)}>
                  <Check className="w-5 h-5" /> Aceptar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div className="card p-4 mt-5">
          <p className="font-display text-lg mb-2">Últimas decisiones</p>
          <div className="space-y-2">
            {decided.map(d => (
              <div key={d.id} className="text-sm border-b border-gold/10 pb-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {d.accepted ? '✅' : '✖️'} {d.name}
                    {d.radicado ? <span className="text-gold-soft"> · radicado {d.radicado}</span> : null}
                  </span>
                  <span className={`text-xs shrink-0 ${d.wa === 'ok' ? 'text-emerald-300' : d.wa === 'error' ? 'text-red-300' : 'text-cream/50'}`}>
                    {d.wa === 'ok' ? 'WhatsApp enviado' : d.wa === 'error' ? 'No se envió' : 'Enviando…'}
                  </span>
                </div>
                {d.wa === 'error' && (
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => notify(d.id)}>
                      Reintentar
                    </button>
                    <a className="btn btn-ghost !py-1.5 text-xs" href={manualLink(d)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="w-4 h-4" /> Escribirle a mano
                    </a>
                    {d.waError && <span className="text-[11px] text-red-300/80">{d.waError}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
};
