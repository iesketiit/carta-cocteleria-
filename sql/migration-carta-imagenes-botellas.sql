-- =========================================================================
-- 403 · CARTA CON FOTOS + BOTELLITA QUE SE GASTA
--
--   1) bar_products.image_url: foto de cada producto de la carta.
--   2) Bucket público "bar-images" (fotos). Solo "inventario"/admin del
--      evento puede subir, cambiar o borrar; las fotos se ven sin login.
--   3) bar_save_product ahora recibe la foto (p_image_url).
--   4) bar_bottle_levels: cuánto licor queda en COCTELERIA por botella.
--      Lo puede llamar el cajero de barra, el bartender y inventario, para
--      que a los dos les salga la alerta "trae una nueva botella".
--
-- Se puede correr más de una vez sin dañar nada. No borra datos.
-- =========================================================================

-- 1) Foto del producto
alter table public.bar_products add column if not exists image_url text;

-- 2) Bucket y permisos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bar-images', 'bar-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists bar_images_select_public on storage.objects;
create policy bar_images_select_public on storage.objects for select
  using (bucket_id = 'bar-images');

-- La primera carpeta del archivo es el id del evento: {evento}/{archivo}.jpg
drop policy if exists bar_images_write_staff on storage.objects;
create policy bar_images_write_staff on storage.objects for all to authenticated
  using (
    bucket_id = 'bar-images'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then public.has_staff_role('inventario', ((storage.foldername(name))[1])::uuid)
             else false end
  )
  with check (
    bucket_id = 'bar-images'
    and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then public.has_staff_role('inventario', ((storage.foldername(name))[1])::uuid)
             else false end
  );

-- 3) Guardar producto (ahora con foto). Se reemplaza la firma anterior.
drop function if exists public.bar_save_product(uuid, uuid, text, text, text, numeric, uuid, text, text, boolean, int, jsonb);

create or replace function public.bar_save_product(
  p_event_id uuid, p_id uuid, p_name text, p_kind text, p_spirit text, p_price numeric,
  p_bottle_item_id uuid, p_recipe text, p_description text, p_active boolean, p_sort int, p_ingredients jsonb,
  p_image_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  ing jsonb;
  v_image text := nullif(trim(coalesce(p_image_url, '')), '');
begin
  if not public.has_staff_role('inventario', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_name), '') = '' or p_price is null or p_price < 0 then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001';
  end if;
  -- La foto solo puede ser una de nuestro bucket (o ninguna).
  if v_image is not null and v_image !~ '^https://[^/]+/storage/v1/object/public/bar-images/' then
    raise exception 'INVALID_IMAGE' using errcode = 'P0001';
  end if;
  insert into public.bar_products (id, event_id, name, kind, spirit, price, bottle_item_id, recipe, description, active, sort, image_url)
  values (v_id, p_event_id, trim(p_name), p_kind, coalesce(nullif(p_spirit, ''), 'otro'), p_price, p_bottle_item_id,
          nullif(trim(coalesce(p_recipe, '')), ''), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_active, true), coalesce(p_sort, 0),
          v_image)
  on conflict (id) do update set
    name = excluded.name, kind = excluded.kind, spirit = excluded.spirit, price = excluded.price,
    bottle_item_id = excluded.bottle_item_id, recipe = excluded.recipe, description = excluded.description,
    active = excluded.active, sort = excluded.sort, image_url = excluded.image_url
  where public.bar_products.event_id = p_event_id;

  delete from public.bar_recipe_ingredients where product_id = v_id;
  for ing in select * from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) loop
    if (ing->>'itemId') is not null and coalesce((ing->>'ml')::numeric, 0) > 0 then
      insert into public.bar_recipe_ingredients (product_id, item_id, ml)
      values (v_id, (ing->>'itemId')::uuid, (ing->>'ml')::numeric)
      on conflict (product_id, item_id) do update set ml = excluded.ml;
    end if;
  end loop;
  return v_id;
end;
$$;
grant execute on function public.bar_save_product(uuid, uuid, text, text, text, numeric, uuid, text, text, boolean, int, jsonb, text) to authenticated;

-- 4) La botellita: licor que queda en COCTELERIA, por botella.
--   remainingMl : ml que deberían quedar (cargas + traslados − consumo de cócteles ± ajustes)
--   currentPct  : qué tan llena está la botella que se está usando (0–100)
--   spareBottles: botellas llenas de reserva en cocteleria, además de la que se usa
--   status      : 'ok' | 'low' (queda 25 % o menos) | 'empty' (no alcanza para otro trago)
create or replace function public.bar_bottle_levels(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_role('cajero_barra', p_event_id) or public.has_staff_role('bartender', p_event_id)
          or public.has_staff_role('inventario', p_event_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'itemId', t.id, 'name', t.name, 'spirit', t.spirit, 'bottleMl', t.bottle_ml,
      'remainingMl', t.rem,
      'minServingMl', t.min_ml,
      'currentPct', case when t.rem <= 0 then 0
                         else round((t.rem - (ceil(t.rem / t.bottle_ml) - 1) * t.bottle_ml) / t.bottle_ml * 100) end,
      'spareBottles', case when t.rem <= 0 then 0 else ceil(t.rem / t.bottle_ml) - 1 end,
      -- empty: no queda para ni un trago más (o está en 0). low: queda 25 % o menos.
      'status', case when t.rem <= 0 or (t.min_ml is not null and t.rem < t.min_ml) then 'empty'
                     when t.rem <= t.bottle_ml * 0.25 then 'low' else 'ok' end
    ) order by (t.rem / t.bottle_ml), t.name)
    from (
      select i.id, i.name, i.spirit, i.bottle_ml,
             greatest(0, coalesce(sum(m.bottles * i.bottle_ml + m.ml) filter (where m.kind <> 'conteo'), 0))::numeric as rem,
             (select min(r.ml) from public.bar_recipe_ingredients r
                join public.bar_products p on p.id = r.product_id
               where r.item_id = i.id and p.active and p.kind in ('coctel', 'shot'))::numeric as min_ml
        from public.bar_items i
        join public.bar_stock_moves m on m.item_id = i.id and m.pool = 'cocteleria'
       where i.event_id = p_event_id and i.active
       group by i.id, i.name, i.spirit, i.bottle_ml
    ) t
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.bar_bottle_levels(uuid) to authenticated;
