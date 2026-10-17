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
  REQUEST_NOT_FOUND: 'Esa solicitud ya no existe.',
  ALREADY_DECIDED: 'Otra persona ya decidió esta solicitud.',
  NOT_DECIDED: 'Esa solicitud todavía no está decidida.',
  RADICADO_FAILED: 'No se pudo crear el radicado. Intenta de nuevo.',
  ALREADY_PAID: 'Esta persona ya está cobrada.',
  NOT_ACCEPTED: 'Esta persona no está aceptada.',
  NOT_PAID: 'Este cobro ya no está marcado como cobrado.',
  RADICADO_MISMATCH: 'El radicado no coincide. Pídele que te muestre su mensaje de WhatsApp.',
  RECIPE_ML_REQUIRED: 'Un cóctel o shot necesita al menos un licor con sus ml por trago.',
  BOTTLE_ML_REQUIRED: 'Escribe cuántos ml trae la botella.',
  BOTTLE_REQUIRED: 'Elige una botella real del inventario (o crea una con sus ml).',
  INVALID_IMAGE: 'Esa foto no es válida. Súbela de nuevo desde aquí.',
  ORDER_NOT_FOUND: 'Ese pedido no existe.',
  VOID_NOT_ALLOWED: 'Ya no se puede anular: el bartender lo entregó o pasaron más de 15 minutos. Pide ayuda al administrador.',
  UNDO_NOT_ALLOWED: 'Solo se puede deshacer en los primeros 10 minutos, y quien cobró. Pide ayuda a un administrador.',
};

export const errText = (e: unknown, fallback = 'Algo salió mal. Intenta de nuevo.'): string => {
  const msg = (e as { message?: string })?.message || String(e || '');
  for (const k of Object.keys(ERRORS)) if (msg.includes(k)) return ERRORS[k];
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sin conexión. Revisa la señal.';
  return msg || fallback;
};
