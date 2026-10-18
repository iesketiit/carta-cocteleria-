import { useCallback, useEffect, useState } from 'react';
import { supabase, errText } from './supabase';
import { readLocal, writeLocal } from './store';
import { PayMethod } from './types';

// Pedidos de barra que se guardan en el celular y se suben cuando hay señal.
// El id lo pone el celular: si un pedido llega dos veces, la base lo ignora.

export interface QueuedOrder {
  id: string;
  eventId: string;
  payment: PayMethod;
  items: { productId: string; qty: number; name: string; price: number }[];
  total: number;
  createdAt: string;
  error?: string; // la base lo rechazó (no es falta de señal)
}

const KEY = '403-barra-cola';
const SYNCED_KEY = '403-barra-subidos';

const read = () => readLocal<QueuedOrder[]>(KEY, []);
const write = (list: QueuedOrder[]) => {
  writeLocal(KEY, list);
  window.dispatchEvent(new Event('403-queue'));
};

export const enqueueOrder = (o: QueuedOrder) => write([...read(), o]);

export interface SyncedInfo {
  id: string;
  number: number;
}

let syncing = false;

export const syncOrders = async (): Promise<void> => {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    for (const o of read()) {
      if (o.error) continue;
      // Sin respuesta en 12 s = señal mala: se corta y se reintenta luego
      // (el id del pedido evita duplicados si sí había llegado).
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 12000);
      let data: unknown = null;
      let error: { message?: string; code?: string } | null = null;
      try {
        const res = await supabase
          .rpc('bar_create_order', {
            p_id: o.id,
            p_event_id: o.eventId,
            p_payment_method: o.payment,
            p_items: o.items.map(i => ({ productId: i.productId, qty: i.qty })),
            p_created_at: o.createdAt,
          })
          .abortSignal(ctrl.signal);
        data = res.data;
        error = res.error;
      } catch (e) {
        error = { message: e instanceof Error ? e.message : String(e) };
      } finally {
        window.clearTimeout(timer);
      }
      if (error) {
        // Solo los rechazos de la base (código P0001, ej. producto que ya no
        // existe) son definitivos. Señal, servidor caído, sesión vencida o
        // sin permiso momentáneo: se queda en cola y se reintenta.
        const msg = error.message || '';
        const permanent = error.code === 'P0001' && !/NOT_AUTHORIZED/.test(msg);
        if (!permanent) break;
        write(read().map(x => (x.id === o.id ? { ...x, error: errText(error) } : x)));
        continue;
      }
      write(read().filter(x => x.id !== o.id));
      const synced = readLocal<SyncedInfo[]>(SYNCED_KEY, []);
      writeLocal(SYNCED_KEY, [{ id: o.id, number: (data as { number: number }).number }, ...synced].slice(0, 50));
      window.dispatchEvent(new CustomEvent('403-synced', { detail: { id: o.id, number: (data as { number: number }).number } }));
    }
  } finally {
    syncing = false;
  }
};

export const discardOrder = (id: string) => write(read().filter(x => x.id !== id));

// Volver a intentar un pedido que la base rechazó (ej. después de arreglar la carta).
export const retryOrder = (id: string) => {
  write(read().map(x => (x.id === id ? { ...x, error: undefined } : x)));
  void syncOrders();
};

export const useOrderQueue = () => {
  const [queue, setQueue] = useState<QueuedOrder[]>(read);
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = useCallback(() => setQueue(read()), []);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      syncOrders();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('403-queue', refresh);
    const t = setInterval(() => syncOrders(), 15000);
    syncOrders();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('403-queue', refresh);
      clearInterval(t);
    };
  }, [refresh]);

  return { queue, online, pending: queue.filter(q => !q.error).length, failed: queue.filter(q => q.error) };
};
