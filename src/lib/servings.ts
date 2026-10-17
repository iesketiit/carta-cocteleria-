import { BarProduct, BottleLevel } from './types';

export interface Serving {
  name: string;
  count: number;
}

// Cuántos tragos más alcanzan de cada cóctel/shot que usa esta botella.
// Un trago con varios licores está limitado por el que primero se acabe.
// `remainingOf` da los ml que quedan de cada botella (en este momento o ya
// descontando un pedido).
export const servingsForItem = (itemId: string, products: BarProduct[], remainingOf: (itemId: string) => number): Serving[] =>
  products
    .filter(p => p.active && (p.kind === 'coctel' || p.kind === 'shot'))
    .filter(p => (p.ingredients ?? []).some(i => i.item_id === itemId && Number(i.ml) > 0))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map(p => ({
      name: p.name,
      count: Math.min(
        ...(p.ingredients ?? []).filter(i => Number(i.ml) > 0).map(i => Math.floor(Math.max(0, remainingOf(i.item_id)) / Number(i.ml)))
      ),
    }));

// "1 Whisky Sour · 3 Shot de whisky" (solo los que todavía alcanzan, máx. 3).
export const servingsText = (list: Serving[]): string | null => {
  const ok = list.filter(s => s.count > 0);
  if (ok.length === 0) return null;
  const shown = ok.slice(0, 3).map(s => `${s.count} ${s.name}`);
  return shown.join(' · ') + (ok.length > 3 ? ` · +${ok.length - 3} más` : '');
};

export const remainingFromLevels =
  (levels: BottleLevel[], used: Record<string, number> = {}) =>
  (itemId: string): number =>
    (levels.find(l => l.itemId === itemId)?.remainingMl ?? 0) - (used[itemId] ?? 0);
