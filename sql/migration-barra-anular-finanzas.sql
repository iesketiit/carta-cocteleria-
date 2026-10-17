-- =========================================================================
-- 403 · BARRA: anular ventas, ml obligatorios en cócteles, y global
--
--   1) bar_save_product: un cóctel o shot DEBE llevar al menos un licor con
--      sus ml (sin eso la botellita no puede gastarse). Incluye la foto.
--   2) bar_cashier_void: el cajero anula SU venta mal hecha, cuando quiera.
--      Queda registrada como "anulado" (quién y cuándo) para el cierre.
--      Si el bartender aún no la entregaba, el inventario vuelve; si ya la
--      entregó, el licor sí se gastó y el inventario no se toca.
--   3) Finanzas (global en King): el rol de finanzas puede leer las ventas de
--      la barra y ver el total cobrado en la puerta de /envivo.
--
-- Se puede correr más de una vez. No borra datos.
-- =========================================================================

-- 1) Guardar producto
drop function if exists public.bar_save_product(uuid, uuid, text, text, text, numeric, uuid, text, text, boolean, int, jsonb, text);

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
  v_with_ml int := 0;
begin
  if not public.has_staff_role('inventario', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_name), '') = '' or p_price is null or p_price < 0 then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001';
  end if;
  if v_image is not null and v_image !~ '^https://[^/]+/storage/v1/object/public/bar-images/' then
    raise exception 'INVALID_IMAGE' using errcode = 'P0001';
  end if;

  -- Cóctel / shot: al menos un licor con ml (para que la botellita se gaste).
  if p_kind in ('coctel', 'shot') then
    select count(*) into v_with_ml
      from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) e
     where nullif(e->>'itemId', '') is not null and coalesce((e->>'ml')::numeric, 0) > 0;
    if v_with_ml = 0 then
      raise exception 'RECIPE_ML_REQUIRED' using errcode = 'P0001';
    end if;
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
    if nullif(ing->>'itemId', '') is not null and coalesce((ing->>'ml')::numeric, 0) > 0 then
      insert into public.bar_recipe_ingredients (product_id, item_id, ml)
      values (v_id, (ing->>'itemId')::uuid, (ing->>'ml')::numeric)
      on conflict (product_id, item_id) do update set ml = excluded.ml;
    end if;
  end loop;
  return v_id;
end;
$$;
grant execute on function public.bar_save_product(uuid, uuid, text, text, text, numeric, uuid, text, text, boolean, int, jsonb, text) to authenticated;

-- 2) El cajero anula su venta (o inventario/admin, cuando sea)
create or replace function public.bar_cashier_void(p_order_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.bar_orders;
  v_admin boolean;
begin
  select * into o from public.bar_orders where id = p_order_id;
  if o.id is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_admin := public.has_staff_role('inventario', o.event_id);
  if not v_admin then
    if o.cashier_id is distinct from auth.uid() or not public.has_staff_role('cajero_barra', o.event_id) then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
  end if;
  if o.status = 'anulado' then return; end if;
  update public.bar_orders
     set status = 'anulado', voided_at = now(), voided_by = auth.uid(),
         note = coalesce(note || ' · ', '') || 'Anulado: ' || coalesce(nullif(trim(p_note), ''), 'venta mal hecha')
   where id = p_order_id;
  -- Si ya se entregó, el licor ya se usó: el inventario no vuelve.
  if o.status = 'pendiente' then
    delete from public.bar_stock_moves where order_id = p_order_id;
  end if;
end;
$$;
grant execute on function public.bar_cashier_void(uuid, text) to authenticated;

-- 3) Global (Finanzas en King)
drop policy if exists bar_orders_finance_read on public.bar_orders;
create policy bar_orders_finance_read on public.bar_orders for select to authenticated
  using (public.has_finance_access());

-- Total cobrado en la puerta de /envivo por ciudad (sin datos personales).
create or replace function public.finance_envivo_totals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_finance_access() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('eventId', event_id, 'people', n, 'total', t))
    from (
      select event_id, count(*) as n, coalesce(sum(amount), 0) as t
        from public.envivo_requests
       where status = 'paid'
       group by event_id
    ) s
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.finance_envivo_totals() to authenticated;
