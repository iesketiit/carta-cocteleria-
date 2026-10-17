export type StaffRole = 'caja_entradas' | 'cajero_barra' | 'bartender' | 'inventario' | 'curador';

export interface EventLite {
  id: string;
  city: string;
  currency: string;
  targetDate: string | null;
}

export interface Access {
  isAdmin: boolean;
  name: string | null;
  roles: { role: StaffRole; eventId: string | null }[];
  events: EventLite[];
}

export interface BarItem {
  id: string;
  event_id: string;
  name: string;
  spirit: string;
  bottle_ml: number;
  bottle_price: number | null;
  active: boolean;
}

export interface BarProduct {
  id: string;
  event_id: string;
  name: string;
  kind: 'coctel' | 'botella' | 'shot' | 'sin_alcohol' | 'otro';
  spirit: string;
  price: number;
  bottle_item_id: string | null;
  recipe: string | null;
  description: string | null;
  image_url?: string | null;
  active: boolean;
  sort: number;
  ingredients?: { item_id: string; ml: number }[];
}

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export type PayMethod = 'efectivo' | 'transferencia' | 'deuna';

// Nivel de una botella de cocteleria (viene de bar_bottle_levels).
export interface BottleLevel {
  itemId: string;
  name: string;
  spirit: string;
  bottleMl: number;
  remainingMl: number;
  minServingMl: number | null;
  currentPct: number;
  spareBottles: number;
  status: 'ok' | 'low' | 'empty';
}
