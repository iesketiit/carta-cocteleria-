import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { BarItem, BarProduct } from './types';
import { readLocal, writeLocal } from './store';

// Carta e inventario del evento. Se guarda en el celular para seguir
// vendiendo y viendo recetas sin señal.
export const useCatalog = (eventId: string) => {
  const key = `403-barra-carta-${eventId}`;
  const [products, setProducts] = useState<BarProduct[]>(() => readLocal<BarProduct[]>(key, []));
  const [items, setItems] = useState<BarItem[]>(() => readLocal<BarItem[]>(key + '-items', []));
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const [p, i, ing] = await Promise.all([
      supabase.from('bar_products').select('*').eq('event_id', eventId).order('sort').order('name'),
      supabase.from('bar_items').select('*').eq('event_id', eventId).order('name'),
      supabase.from('bar_recipe_ingredients').select('product_id, item_id, ml'),
    ]);
    setLoading(false);
    if (p.error || i.error) return;
    const byProduct = new Map<string, { item_id: string; ml: number }[]>();
    for (const r of (ing.data ?? []) as { product_id: string; item_id: string; ml: number }[]) {
      const list = byProduct.get(r.product_id) ?? [];
      list.push({ item_id: r.item_id, ml: Number(r.ml) });
      byProduct.set(r.product_id, list);
    }
    const prods = ((p.data ?? []) as BarProduct[]).map(x => ({
      ...x,
      price: Number(x.price),
      ingredients: byProduct.get(x.id) ?? [],
    }));
    setProducts(prods);
    setItems((i.data ?? []) as BarItem[]);
    writeLocal(key, prods);
    writeLocal(key + '-items', i.data ?? []);
  }, [eventId, key]);

  useEffect(() => {
    setProducts(readLocal<BarProduct[]>(key, []));
    setItems(readLocal<BarItem[]>(key + '-items', []));
    reload();
  }, [key, reload]);

  return { products, items, loading, reload };
};
