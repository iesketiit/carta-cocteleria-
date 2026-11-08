import { supabase } from './supabase';

export interface Tier {
  id: string;
  name: string;
  price: number;
  isGroupTier?: boolean;
  groupSize?: number;
  exclusive?: boolean;
  /** 0 o null = sin límite. */
  capacity?: number | null;
  /** Cupos que quedan (null = sin límite). */
  available?: number | null;
  soldOut?: boolean;
}

// Localidades de la ciudad con los cupos que quedan de verdad (lo vendido
// en la web, en caja y en /envivo). Si aún no se corrió el SQL nuevo, se
// leen tal cual de events.ticket_tiers (sin cupos).
export const loadTiers = async (eventId: string): Promise<Tier[]> => {
  const rpc = await supabase.rpc('envivo_tiers', { p_event_id: eventId });
  if (!rpc.error && Array.isArray(rpc.data)) {
    return (rpc.data as Tier[]).map(t => ({ ...t, price: Number(t.price) || 0 }));
  }
  const { data } = await supabase.from('events').select('ticket_tiers').eq('id', eventId).maybeSingle();
  return ((data?.ticket_tiers as Tier[]) ?? []).map(t => ({ ...t, price: Number(t.price) || 0, available: null }));
};

export const tierStock = (t: Tier): string => {
  if (t.soldOut) return 'Agotada';
  if (t.available == null) return 'Sin límite';
  return t.available === 1 ? 'Queda 1' : `Quedan ${t.available}`;
};
