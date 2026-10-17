import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { BottleLevel } from './types';
import { readLocal, writeLocal } from './store';

const POLL_MS = 10000;

// Nivel de las botellas de cocteleria. Se revisa cada 10 s y cada vez que
// un pedido llega a la base. Si no hay señal se queda con el último nivel.
export const useBottleLevels = (eventId: string, enabled = true) => {
  const key = `403-botellas-${eventId}`;
  const [levels, setLevels] = useState<BottleLevel[]>(() => readLocal<BottleLevel[]>(key, []));
  const [loaded, setLoaded] = useState(false);
  const seenBad = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!eventId || !enabled) return;
    const { data, error } = await supabase.rpc('bar_bottle_levels', { p_event_id: eventId });
    if (error) return;
    const next = (data as BottleLevel[]) ?? [];
    // Vibra cuando una botella pasa a "poca" o "vacía".
    const bad = new Set(next.filter(b => b.status !== 'ok').map(b => `${b.itemId}:${b.status}`));
    if ([...bad].some(k => !seenBad.current.has(k))) {
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        /* ignorar */
      }
    }
    seenBad.current = bad;
    setLevels(next);
    setLoaded(true);
    writeLocal(key, next);
  }, [eventId, enabled, key]);

  useEffect(() => {
    seenBad.current = new Set();
    setLevels(readLocal<BottleLevel[]>(key, []));
    setLoaded(false);
    load();
    if (!enabled) return;
    const t = setInterval(load, POLL_MS);
    window.addEventListener('403-synced', load);
    window.addEventListener('403-levels', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('403-synced', load);
      window.removeEventListener('403-levels', load);
    };
  }, [key, load, enabled]);

  return { levels, loaded, reload: load };
};
