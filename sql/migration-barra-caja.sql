-- =========================================================================
-- 403 · CAJA (efectivo de entradas) + BARRA (cocteleria e inventario)
--
-- Lo usa la web aparte "carta-cocteleria" (repo iesketiit/carta-cocteleria-):
--   /caja       → cobro en EFECTIVO de entradas (ej. en D'VORA)
--   /barra      → cajero de barra: vende cócteles / botellas
--   /bartender  → pedidos por preparar + recetas
--   /admin      → productos, recetas, inventario, cierres y personal
--
-- Personal: se crea la cuenta en King (Usuarios → Crear, rol "Staff de
-- puerta") y aquí se le dan permisos en /admin → Personal.
--
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Es seguro volver a ejecutarlo.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Personal y permisos
-- -------------------------------------------------------------------------
create table if not exists public.staff_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('caja_entradas', 'cajero_barra', 'bartender', 'inventario')),
  event_id uuid references public.events(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists staff_roles_unique
  on public.staff_roles (user_id, role, coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.staff_roles enable row level security;
drop policy if exists staff_roles_select on public.staff_roles;
create policy staff_roles_select on public.staff_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ¿Puede quien llama hacer <rol> en <evento>? Admin global / de ciudad: sí.
create or replace function public.has_staff_role(p_role text, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_event_access(p_event_id)
      or exists (
        select 1 from public.staff_roles s
         where s.user_id = auth.uid()
           and s.role = p_role
           and (s.event_id is null or s.event_id = p_event_id)
      );
$$;

-- Lo que puede hacer quien inicia sesión en la web (para armar el menú).
create or replace function public.my_staff_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'isAdmin', exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'local_admin')),
    'name', (select full_name from public.profiles where id = auth.uid()),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('role', role, 'eventId', event_id))
        from public.staff_roles where user_id = auth.uid()
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'city', e.city, 'currency', coalesce(e.currency, 'USD'),
                                          'targetDate', e.target_date) order by e.target_date)
        from public.events e
       where e.status = 'open'
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.my_staff_access() to authenticated;

-- Admin: dar / quitar permisos por correo.
create or replace function public.staff_set_role(p_email text, p_role text, p_event_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() and not (p_event_id is not null and public.has_event_access(p_event_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_enabled then
    insert into public.staff_roles (user_id, role, event_id, created_by)
    values (v_user, p_role, p_event_id, auth.uid())
    on conflict do nothing;
  else
    delete from public.staff_roles
     where user_id = v_user and role = p_role and event_id is not distinct from p_event_id;
  end if;
  return jsonb_build_object('userId', v_user);
end;
$$;
grant execute on function public.staff_set_role(text, text, uuid, boolean) to authenticated;

create or replace function public.staff_list(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.has_event_access(p_event_id) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('email', p.email, 'name', p.full_name, 'role', s.role, 'eventId', s.event_id)
                     order by p.full_name)
      from public.staff_roles s join public.profiles p on p.id = s.user_id
     where s.event_id is null or s.event_id = p_event_id
  ), '[]'::jsonb) end;
$$;
grant execute on function public.staff_list(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 2) CAJA: cobro en efectivo de entradas a personas YA APROBADAS
-- -------------------------------------------------------------------------
alter table public.purchased_tickets add column if not exists paid_cash boolean not null default false;
alter table public.purchased_tickets add column if not exists cash_collected_by uuid;

-- Buscar aprobados de la ciudad (nombre, correo, teléfono o cédula).
create or replace function public.cash_search_people(p_event_id uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(trim(coalesce(p_query, '')));
begin
  if not public.has_staff_role('caja_entradas', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if length(q) < 3 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'name') from (
      select jsonb_build_object(
        'userId', p.id,
        'name', coalesce(p.full_name, ar.full_name),
        'email', ar.email,
        'phone', coalesce(p.phone, ar.phone),
        'hasAccount', p.id is not null,
        'tickets', (select count(*) from public.purchased_tickets t
                     where t.user_id = p.id and t.event_id = p_event_id and t.status in ('valid', 'used'))
      ) as x
        from public.access_requests ar
        left join public.profiles p on lower(p.email) = lower(ar.email)
       where ar.event_id = p_event_id
         and ar.status = 'approved'
         and (lower(ar.full_name) like '%' || q || '%'
              or lower(ar.email) like '%' || q || '%'
              or regexp_replace(coalesce(ar.phone, ''), '\D', '', 'g') like '%' || regexp_replace(q, '\D', '', 'g') || '%' and length(regexp_replace(q, '\D', '', 'g')) >= 4)
       limit 15
    ) s
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.cash_search_people(uuid, text) to authenticated;

-- Cobrar en efectivo: crea la(s) entrada(s) ya pagadas, con QR, a su nombre.
-- Palco: una entrada por persona (los nombres se llenan después).
create or replace function public.cash_sell_ticket(
  p_user_id uuid,
  p_event_id uuid,
  p_tier_id text,
  p_quantity int default 1,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cashier uuid := auth.uid();
  v_profile public.profiles;
  v_event public.events;
  v_tier jsonb;
  v_is_group boolean;
  v_group int;
  v_price numeric;
  v_total numeric;
  v_people int;
  v_cap int;
  v_request public.access_requests;
  v_batch uuid;
  v_primary uuid;
  v_id uuid;
  i int;
  v_sub text;
  v_claims text;
begin
  if v_cashier is null or not public.has_staff_role('caja_entradas', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if v_profile.id is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Solo personas aprobadas para esta ciudad.
  select ar.* into v_request from public.access_requests ar
   where lower(ar.email) = lower(v_profile.email) and ar.event_id = p_event_id and ar.status = 'approved'
   order by ar.approved_at desc nulls last limit 1;
  if v_request.id is null and v_profile.role not in ('promoter', 'admin', 'local_admin') then
    raise exception 'NOT_APPROVED' using errcode = 'P0001';
  end if;

  v_tier := public.tier_json(p_event_id, p_tier_id);
  if v_tier is null then
    raise exception 'INVALID_TIER' using errcode = 'P0001';
  end if;
  v_is_group := coalesce((v_tier->>'isGroupTier')::boolean, false);
  v_group := greatest(1, coalesce(nullif(v_tier->>'groupSize', '')::int, 1));
  v_price := public.tier_price(p_event_id, p_tier_id);

  if v_is_group then
    v_people := v_group;
    v_total := v_price;
  else
    if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    v_people := p_quantity;
    v_total := v_price * p_quantity;
  end if;

  -- Agotada / aforo (también cuentan los pases de compra de King).
  if public.pass_seats_left(p_event_id, p_tier_id, p_user_id) < v_people then
    if public.tier_sold_out(p_event_id, p_tier_id) then
      raise exception 'TIER_SOLD_OUT' using errcode = 'P0001';
    end if;
    v_cap := public.tier_capacity(p_event_id, p_tier_id);
    if v_cap > 0 and public.tier_sold_quantity_for(p_event_id, p_tier_id, null)
                     + public.tier_held_seats(p_event_id, p_tier_id, p_user_id) + v_people > v_cap then
      raise exception 'TIER_SOLD_OUT' using errcode = 'P0001';
    end if;
  end if;

  -- Plazo vencido: el cobro presencial lo extiende.
  if v_request.id is not null and v_request.purchase_deadline is not null
     and now() > v_request.purchase_deadline and v_request.deadline_override_by is null then
    update public.access_requests set deadline_override_by = v_cashier where id = v_request.id;
  end if;

  -- Las reglas de la compra web (dueño, precio, límite de 3…) no aplican a
  -- un cobro presencial: se insertan como proceso del servidor y se vuelve
  -- a la sesión del cajero apenas termina.
  v_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);

  if v_is_group then
    v_batch := gen_random_uuid();
    for i in 1 .. v_people loop
      insert into public.purchased_tickets (
        user_id, buyer_name, buyer_email, ticket_tier, tier_name, quantity, unit_price, discount_applied,
        total_price, currency, qr_payload, status, event_id, group_batch_id, is_group_primary, group_holder_name,
        paid_cash, cash_collected_by, courtesy_note
      ) values (
        p_user_id, v_profile.full_name, v_profile.email, p_tier_id, v_tier->>'name', 1,
        case when i = 1 then v_price else 0 end, 0, case when i = 1 then v_total else 0 end,
        coalesce(v_event.currency, 'USD'), 'PENDING_SERVER_QR', 'pending_verification', p_event_id, v_batch, i = 1,
        case when i = 1 then v_profile.full_name else 'Acompañante ' || (i - 1) || ' de ' || v_profile.full_name end,
        true, v_cashier, nullif(trim(coalesce(p_note, '')), '')
      ) returning id into v_id;
      if i = 1 then v_primary := v_id; end if;
    end loop;
    update public.purchased_tickets set status = 'valid' where group_batch_id = v_batch;
  else
    insert into public.purchased_tickets (
      user_id, buyer_name, buyer_email, ticket_tier, tier_name, quantity, unit_price, discount_applied,
      total_price, currency, qr_payload, status, event_id, paid_cash, cash_collected_by, courtesy_note
    ) values (
      p_user_id, v_profile.full_name, v_profile.email, p_tier_id, v_tier->>'name', v_people, v_price, 0,
      v_total, coalesce(v_event.currency, 'USD'), 'PENDING_SERVER_QR', 'pending_verification', p_event_id,
      true, v_cashier, nullif(trim(coalesce(p_note, '')), '')
    ) returning id into v_primary;
    update public.purchased_tickets set status = 'valid' where id = v_primary;
    perform public.split_group_ticket(v_primary);
  end if;

  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  return jsonb_build_object('ticketId', v_primary, 'people', v_people, 'total', v_total,
                            'currency', coalesce(v_event.currency, 'USD'), 'tierName', v_tier->>'name');
end;
$$;
grant execute on function public.cash_sell_ticket(uuid, uuid, text, int, text) to authenticated;

-- Cierre de caja de entradas: cuánto cobró cada cajero (hoy o total).
create or replace function public.cash_summary(p_event_id uuid, p_only_mine boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_role('caja_entradas', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(r order by r->>'cashier') from (
      select jsonb_build_object(
        'cashier', coalesce(pc.full_name, 'Sin nombre'),
        'sales', count(*),
        'people', sum(case when t.group_batch_id is not null then
                        (select count(*) from public.purchased_tickets x where x.group_batch_id = t.group_batch_id and x.status <> 'rejected')
                      else 1 end),
        'total', sum(t.total_price),
        'today', sum(t.total_price) filter (where t.purchase_date >= date_trunc('day', now() at time zone 'America/Guayaquil') at time zone 'America/Guayaquil')
      ) r
        from public.purchased_tickets t
        left join public.profiles pc on pc.id = t.cash_collected_by
       where t.event_id = p_event_id and t.paid_cash and t.status in ('valid', 'used')
         and (t.is_group_primary is not false)
         and (not p_only_mine or t.cash_collected_by = auth.uid() or public.has_event_access(p_event_id))
       group by pc.full_name
    ) s
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.cash_summary(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 3) BARRA: productos, recetas, inventario, pedidos
-- -------------------------------------------------------------------------
-- Licor / botella del inventario (ej. "Jack Daniel's 750 ml").
create table if not exists public.bar_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  spirit text not null default 'otro',           -- whisky, tequila, ron, vodka, gin, aguardiente, otro
  bottle_ml int not null default 750 check (bottle_ml > 0),
  bottle_price numeric,                          -- precio de venta de la botella entera (opcional)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Lo que se vende en la barra (cóctel, botella, shot, sin alcohol…).
create table if not exists public.bar_products (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  kind text not null default 'coctel' check (kind in ('coctel', 'botella', 'shot', 'sin_alcohol', 'otro')),
  spirit text not null default 'otro',
  price numeric not null check (price >= 0),
  bottle_item_id uuid references public.bar_items(id) on delete set null,  -- si kind = 'botella'
  recipe text,                                   -- pasos para el bartender
  description text,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Receta: cuántos ml de cada licor descuenta un cóctel.
create table if not exists public.bar_recipe_ingredients (
  product_id uuid not null references public.bar_products(id) on delete cascade,
  item_id uuid not null references public.bar_items(id) on delete cascade,
  ml numeric not null check (ml > 0),
  primary key (product_id, item_id)
);

-- Movimientos de inventario. pool: 'cocteleria' (botellas para cócteles)
-- o 'venta' (botellas que se venden enteras).
create table if not exists public.bar_stock_moves (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.bar_items(id) on delete cascade,
  pool text not null check (pool in ('cocteleria', 'venta')),
  kind text not null check (kind in ('carga', 'traslado', 'venta_botella', 'consumo_coctel', 'ajuste', 'conteo')),
  bottles numeric not null default 0,            -- + entra / − sale (botellas enteras)
  ml numeric not null default 0,                 -- + entra / − sale (ml sueltos; consumo de cócteles)
  order_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists bar_stock_moves_event on public.bar_stock_moves (event_id, item_id);

-- Pedidos (el id lo genera el celular: así funciona sin señal y no se duplica).
create table if not exists public.bar_orders (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  number int,
  cashier_id uuid,
  payment_method text not null check (payment_method in ('efectivo', 'transferencia', 'deuna')),
  total numeric not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente', 'entregado', 'anulado')),
  note text,
  created_at timestamptz not null default now(),   -- hora del celular (si estaba sin señal)
  synced_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid,
  voided_at timestamptz,
  voided_by uuid
);
create index if not exists bar_orders_event on public.bar_orders (event_id, status, created_at);

create table if not exists public.bar_order_items (
  order_id uuid not null references public.bar_orders(id) on delete cascade,
  product_id uuid references public.bar_products(id) on delete set null,
  name text not null,
  kind text not null,
  qty int not null check (qty > 0),
  unit_price numeric not null,
  primary key (order_id, name)
);

alter table public.bar_items enable row level security;
alter table public.bar_products enable row level security;
alter table public.bar_recipe_ingredients enable row level security;
alter table public.bar_stock_moves enable row level security;
alter table public.bar_orders enable row level security;
alter table public.bar_order_items enable row level security;

-- Lectura: personal de barra del evento. Escritura: solo por las funciones.
drop policy if exists bar_items_read on public.bar_items;
create policy bar_items_read on public.bar_items for select to authenticated
  using (public.has_staff_role('cajero_barra', event_id) or public.has_staff_role('bartender', event_id)
         or public.has_staff_role('inventario', event_id));
drop policy if exists bar_products_read on public.bar_products;
create policy bar_products_read on public.bar_products for select to authenticated
  using (public.has_staff_role('cajero_barra', event_id) or public.has_staff_role('bartender', event_id)
         or public.has_staff_role('inventario', event_id));
drop policy if exists bar_recipe_read on public.bar_recipe_ingredients;
create policy bar_recipe_read on public.bar_recipe_ingredients for select to authenticated
  using (exists (select 1 from public.bar_products p where p.id = product_id
                 and (public.has_staff_role('cajero_barra', p.event_id) or public.has_staff_role('bartender', p.event_id)
                      or public.has_staff_role('inventario', p.event_id))));
drop policy if exists bar_moves_read on public.bar_stock_moves;
create policy bar_moves_read on public.bar_stock_moves for select to authenticated
  using (public.has_staff_role('inventario', event_id) or public.has_staff_role('bartender', event_id));
drop policy if exists bar_orders_read on public.bar_orders;
create policy bar_orders_read on public.bar_orders for select to authenticated
  using (public.has_staff_role('bartender', event_id) or public.has_staff_role('inventario', event_id)
         or cashier_id = auth.uid());
drop policy if exists bar_order_items_read on public.bar_order_items;
create policy bar_order_items_read on public.bar_order_items for select to authenticated
  using (exists (select 1 from public.bar_orders o where o.id = order_id
                 and (public.has_staff_role('bartender', o.event_id) or public.has_staff_role('inventario', o.event_id)
                      or o.cashier_id = auth.uid())));

-- Guardar producto (admin / inventario). p_ingredients: [{itemId, ml}]
create or replace function public.bar_save_product(
  p_event_id uuid, p_id uuid, p_name text, p_kind text, p_spirit text, p_price numeric,
  p_bottle_item_id uuid, p_recipe text, p_description text, p_active boolean, p_sort int, p_ingredients jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  ing jsonb;
begin
  if not public.has_staff_role('inventario', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_name), '') = '' or p_price is null or p_price < 0 then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001';
  end if;
  insert into public.bar_products (id, event_id, name, kind, spirit, price, bottle_item_id, recipe, description, active, sort)
  values (v_id, p_event_id, trim(p_name), p_kind, coalesce(nullif(p_spirit, ''), 'otro'), p_price, p_bottle_item_id,
          nullif(trim(coalesce(p_recipe, '')), ''), nullif(trim(coalesce(p_description, '')), ''), coalesce(p_active, true), coalesce(p_sort, 0))
  on conflict (id) do update set
    name = excluded.name, kind = excluded.kind, spirit = excluded.spirit, price = excluded.price,
    bottle_item_id = excluded.bottle_item_id, recipe = excluded.recipe, description = excluded.description,
    active = excluded.active, sort = excluded.sort
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
grant execute on function public.bar_save_product(uuid, uuid, text, text, text, numeric, uuid, text, text, boolean, int, jsonb) to authenticated;

create or replace function public.bar_save_item(
  p_event_id uuid, p_id uuid, p_name text, p_spirit text, p_bottle_ml int, p_bottle_price numeric, p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if not public.has_staff_role('inventario', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  insert into public.bar_items (id, event_id, name, spirit, bottle_ml, bottle_price, active)
  values (v_id, p_event_id, trim(p_name), coalesce(nullif(p_spirit, ''), 'otro'), coalesce(p_bottle_ml, 750), p_bottle_price, coalesce(p_active, true))
  on conflict (id) do update set
    name = excluded.name, spirit = excluded.spirit, bottle_ml = excluded.bottle_ml,
    bottle_price = excluded.bottle_price, active = excluded.active
  where public.bar_items.event_id = p_event_id;
  return v_id;
end;
$$;
grant execute on function public.bar_save_item(uuid, uuid, text, text, int, numeric, boolean) to authenticated;

-- Movimiento de inventario manual.
--   carga   (inventario): entran botellas a 'cocteleria' o 'venta'
--   traslado (bartender o inventario): 1 botella de 'venta' pasa a 'cocteleria'
--   conteo  (inventario): conteo físico al cierre (se guarda, no descuenta)
--   ajuste  (inventario): corrección con nota obligatoria
create or replace function public.bar_stock_move(
  p_event_id uuid, p_item_id uuid, p_kind text, p_pool text, p_bottles numeric, p_ml numeric, p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'traslado' then
    if not (public.has_staff_role('bartender', p_event_id) or public.has_staff_role('inventario', p_event_id)) then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
    if coalesce(p_bottles, 0) <= 0 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    insert into public.bar_stock_moves (event_id, item_id, pool, kind, bottles, note, created_by)
    values (p_event_id, p_item_id, 'venta', 'traslado', -p_bottles, nullif(trim(coalesce(p_note, '')), ''), auth.uid()),
           (p_event_id, p_item_id, 'cocteleria', 'traslado', p_bottles, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
    return;
  end if;

  if not public.has_staff_role('inventario', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_kind not in ('carga', 'conteo', 'ajuste') or p_pool not in ('cocteleria', 'venta') then
    raise exception 'INVALID_MOVE' using errcode = 'P0001';
  end if;
  if p_kind = 'ajuste' and coalesce(trim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED' using errcode = 'P0001';
  end if;
  insert into public.bar_stock_moves (event_id, item_id, pool, kind, bottles, ml, note, created_by)
  values (p_event_id, p_item_id, p_pool, p_kind, coalesce(p_bottles, 0), coalesce(p_ml, 0),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;
grant execute on function public.bar_stock_move(uuid, uuid, text, text, numeric, numeric, text) to authenticated;

-- Vender (cajero de barra). Funciona con pedidos guardados sin señal: el
-- id lo pone el celular y si llega dos veces no se duplica. Los precios y
-- el total los calcula el servidor. p_items: [{productId, qty}]
create or replace function public.bar_create_order(
  p_id uuid, p_event_id uuid, p_payment_method text, p_items jsonb, p_created_at timestamptz default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.bar_orders;
  it jsonb;
  p public.bar_products;
  v_qty int;
  v_total numeric := 0;
  v_number int;
  ing record;
begin
  if not public.has_staff_role('cajero_barra', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into v_existing from public.bar_orders where id = p_id;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'number', v_existing.number, 'total', v_existing.total, 'duplicate', true);
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('bar_order_number_' || p_event_id::text));
  select coalesce(max(number), 0) + 1 into v_number from public.bar_orders where event_id = p_event_id;

  insert into public.bar_orders (id, event_id, number, cashier_id, payment_method, total, created_at, note)
  values (p_id, p_event_id, v_number, auth.uid(), p_payment_method, 0,
          least(coalesce(p_created_at, now()), now()), nullif(trim(coalesce(p_note, '')), ''));

  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from public.bar_products where id = (it->>'productId')::uuid and event_id = p_event_id;
    v_qty := greatest(1, coalesce((it->>'qty')::int, 1));
    if p.id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
    end if;
    insert into public.bar_order_items (order_id, product_id, name, kind, qty, unit_price)
    values (p_id, p.id, p.name, p.kind, v_qty, p.price)
    on conflict (order_id, name) do update set qty = public.bar_order_items.qty + excluded.qty;
    v_total := v_total + p.price * v_qty;

    -- Inventario: botella entera sale del grupo 'venta'; cóctel descuenta ml de 'cocteleria'.
    if p.kind = 'botella' and p.bottle_item_id is not null then
      insert into public.bar_stock_moves (event_id, item_id, pool, kind, bottles, order_id, created_by)
      values (p_event_id, p.bottle_item_id, 'venta', 'venta_botella', -v_qty, p_id, auth.uid());
    else
      for ing in select * from public.bar_recipe_ingredients where product_id = p.id loop
        insert into public.bar_stock_moves (event_id, item_id, pool, kind, ml, order_id, created_by)
        values (p_event_id, ing.item_id, 'cocteleria', 'consumo_coctel', -(ing.ml * v_qty), p_id, auth.uid());
      end loop;
    end if;
  end loop;

  update public.bar_orders set total = v_total where id = p_id;
  return jsonb_build_object('id', p_id, 'number', v_number, 'total', v_total, 'duplicate', false);
end;
$$;
grant execute on function public.bar_create_order(uuid, uuid, text, jsonb, timestamptz, text) to authenticated;

-- Bartender: marcar entregado.
create or replace function public.bar_mark_delivered(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.bar_orders;
begin
  select * into o from public.bar_orders where id = p_order_id;
  if o.id is null or not public.has_staff_role('bartender', o.event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.bar_orders set status = 'entregado', delivered_at = now(), delivered_by = auth.uid()
   where id = p_order_id and status = 'pendiente';
end;
$$;
grant execute on function public.bar_mark_delivered(uuid) to authenticated;

-- Anular un pedido (solo inventario/admin): devuelve el inventario.
create or replace function public.bar_void_order(p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.bar_orders;
begin
  select * into o from public.bar_orders where id = p_order_id;
  if o.id is null or not public.has_staff_role('inventario', o.event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if o.status = 'anulado' then return; end if;
  update public.bar_orders set status = 'anulado', voided_at = now(), voided_by = auth.uid(),
         note = coalesce(note || ' · ', '') || 'Anulado: ' || coalesce(nullif(trim(p_note), ''), 'sin motivo')
   where id = p_order_id;
  delete from public.bar_stock_moves where order_id = p_order_id;
end;
$$;
grant execute on function public.bar_void_order(uuid, text) to authenticated;

-- Reporte de inventario: por licor y grupo, lo que DEBERÍA haber vs. el
-- último conteo físico.
create or replace function public.bar_stock_report(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_role('inventario', p_event_id) or public.has_staff_role('bartender', p_event_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(r order by r->>'name', r->>'pool') from (
      select jsonb_build_object(
        'itemId', i.id, 'name', i.name, 'spirit', i.spirit, 'bottleMl', i.bottle_ml, 'pool', pools.pool,
        'loadedBottles', coalesce(sum(m.bottles) filter (where m.kind = 'carga'), 0),
        'transferBottles', coalesce(sum(m.bottles) filter (where m.kind = 'traslado'), 0),
        'soldBottles', -coalesce(sum(m.bottles) filter (where m.kind = 'venta_botella'), 0),
        'usedMl', -coalesce(sum(m.ml) filter (where m.kind = 'consumo_coctel'), 0),
        'adjustBottles', coalesce(sum(m.bottles) filter (where m.kind = 'ajuste'), 0),
        'adjustMl', coalesce(sum(m.ml) filter (where m.kind = 'ajuste'), 0),
        'expectedMl', coalesce(sum(m.bottles * i.bottle_ml + m.ml) filter (where m.kind <> 'conteo'), 0),
        'lastCount', (select jsonb_build_object('bottles', c.bottles, 'ml', c.ml, 'at', c.created_at)
                        from public.bar_stock_moves c
                       where c.item_id = i.id and c.pool = pools.pool and c.kind = 'conteo'
                       order by c.created_at desc limit 1)
      ) r
        from public.bar_items i
        cross join (values ('cocteleria'), ('venta')) pools(pool)
        left join public.bar_stock_moves m on m.item_id = i.id and m.pool = pools.pool
       where i.event_id = p_event_id
       group by i.id, i.name, i.spirit, i.bottle_ml, pools.pool
      having count(m.id) > 0
    ) s
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.bar_stock_report(uuid) to authenticated;

-- Cierre de barra: ventas por cajero y por forma de pago.
create or replace function public.bar_sales_summary(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_role('inventario', p_event_id) or public.has_staff_role('cajero_barra', p_event_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'byCashier', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('cashier', coalesce(p.full_name, '—'), 'method', o.payment_method,
                                  'orders', count(*), 'total', sum(o.total)) x
          from public.bar_orders o left join public.profiles p on p.id = o.cashier_id
         where o.event_id = p_event_id and o.status <> 'anulado'
           and (public.has_staff_role('inventario', p_event_id) or o.cashier_id = auth.uid())
         group by p.full_name, o.payment_method
      ) s
    ), '[]'::jsonb),
    'byProduct', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('name', i.name, 'qty', sum(i.qty), 'total', sum(i.qty * i.unit_price)) x
          from public.bar_order_items i join public.bar_orders o on o.id = i.order_id
         where o.event_id = p_event_id and o.status <> 'anulado' and public.has_staff_role('inventario', p_event_id)
         group by i.name
      ) s
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.bar_sales_summary(uuid) to authenticated;
