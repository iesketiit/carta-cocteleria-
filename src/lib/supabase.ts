import { createClient } from '@supabase/supabase-js';

// Mismo Supabase de 403events.com. La clave anon es pública (va en la web);
// todo lo sensible lo controla la base con permisos por rol.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://zhklyoykeiizsxuvrnzq.supabase.co';
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpoa2x5b3lrZWlpenN4dXZybnpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNjE0NzQsImV4cCI6MjEwMjgzNzQ3NH0.8aON8rvMFjOo93PRS3kr9cxHMHFlKAWJRHHQXYg-GtQ';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: '403-barra-auth' },
});

// Mensajes de error de la base → texto entendible.
const ERRORS: Record<string, string> = {
  NOT_AUTHORIZED: 'No tienes permiso para esto. Pide acceso al administrador.',
  NOT_APPROVED: 'Esta persona no está aprobada para esta ciudad.',
  USER_NOT_FOUND: 'No se encontró esa cuenta.',
  TIER_SOLD_OUT: 'Esa localidad está agotada.',
  INVALID_TIER: 'Esa localidad no existe.',
  INVALID_QUANTITY: 'Cantidad no válida.',
  EMPTY_ORDER: 'El pedido está vacío.',
  PRODUCT_NOT_FOUND: 'Un producto ya no existe. Actualiza la carta.',
  INVALID_PRODUCT: 'Revisa el nombre y el precio.',
  NOTE_REQUIRED: 'Escribe el motivo del ajuste.',
  INVALID_QTY: 'Cantidad no válida.',
  RESERVATION_EXPIRED: 'Esa reserva ya venció (pasaron 24 h) o fue rechazada. Cóbrale como venta nueva.',
  RESERVATION_NOT_FOUND: 'No se encontró esa reserva. Busca de nuevo a la persona.',
};

export const errText = (e: unknown, fallback = 'Algo salió mal. Intenta de nuevo.'): string => {
  const msg = (e as { message?: string })?.message || String(e || '');
  for (const k of Object.keys(ERRORS)) if (msg.includes(k)) return ERRORS[k];
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sin conexión. Revisa la señal.';
  return msg || fallback;
};
