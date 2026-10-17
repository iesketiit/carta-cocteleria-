-- =========================================================================
-- 403 · EN VIVO (venta en la puerta con curación)
--
-- Flujo:
--   1) La persona entra a 403events.com/envivo, llena nombre, IG, número y
--      acepta que es mayor de edad  → queda en la cola (envivo_requests).
--   2) El CURADOR (pantalla /curador en la web de caja) la ve en vivo,
--      abre su IG y ACEPTA o RECHAZA. Al aceptar se crea un RADICADO de
--      6 dígitos y el bot de WhatsApp se lo manda a la persona.
--   3) La CAJA (/cobrar) solo ve a los aceptados. La busca por número,
--      nombre, IG o radicado, le pide el radicado, cobra en EFECTIVO y
--      marca "Cobrado". Puede deshacerlo si fue un error (10 min).
--
-- No toca purchased_tickets ni las compras normales de la web.
--
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Es seguro volver a ejecutarlo.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Nuevo permiso de personal: curador
-- -------------------------------------------------------------------------
alter table public.staff_roles drop constraint if exists staff_roles_role_check;
alter table public.staff_roles
  add constraint staff_roles_role_check
  check (role in ('caja_entradas', 'cajero_barra', 'bartender', 'inventario', 'curador'));

-- -------------------------------------------------------------------------
-- 2) Tablas
-- -------------------------------------------------------------------------
-- Qué ciudades tienen /envivo abierto (lo abre y cierra el curador).
create table if not exists public.envivo_settings (
  event_id uuid primary key references public.events(id) on delete cascade,
  open boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.envivo_settings enable row level security;

create table if not exists public.envivo_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  full_name text not null,
  instagram text not null,
  phone text not null,                       -- solo dígitos, con código de país
  adult_accepted_at timestamptz not null,    -- aceptó que es mayor de edad
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'paid')),
  radicado text,                             -- 6 dígitos, se crea al aceptar
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  wa_notified_at timestamptz,
  wa_error text,
  paid_by uuid,
  paid_at timestamptz,
  tier_id text,
  tier_name text,
  amount numeric,
  undo_count int not null default 0,
  last_undo_by uuid,
  last_undo_at timestamptz
);
alter table public.envivo_requests enable row level security;

create unique index if not exists envivo_radicado_unique
  on public.envivo_requests (event_id, radicado) where radicado is not null;
create index if not exists envivo_event_status_idx
  on public.envivo_requests (event_id, status, created_at);
create index if not exists envivo_phone_idx
  on public.envivo_requests (event_id, phone);

-- Sin políticas a propósito: nadie lee ni escribe directo, solo por las
-- funciones de abajo (que revisan el permiso de cada quien).
revoke all on public.envivo_requests from anon, authenticated;
revoke all on public.envivo_settings from anon, authenticated;

-- -------------------------------------------------------------------------
-- 3) Público: ciudades con /envivo abierto y envío del formulario
-- -------------------------------------------------------------------------
create or replace function public.envivo_open_events()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'city', e.city, 'name', e.event_name)
                            order by e.target_date), '[]'::jsonb)
    from public.envivo_settings s
    join public.events e on e.id = s.event_id
   where s.open;
$$;
revoke all on function public.envivo_open_events() from public;
grant execute on function public.envivo_open_events() to anon, authenticated;

create or replace function public.envivo_submit(
  p_event_id uuid,
  p_name text,
  p_instagram text,
  p_phone text,
  p_adult boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_ig text := lower(regexp_replace(trim(coalesce(p_instagram, '')), '^(https?://)?(www\.)?(instagram\.com/)?@?', '', 'i'));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_existing public.envivo_requests;
  v_id uuid;
begin
  if not exists (select 1 from public.envivo_settings where event_id = p_event_id and open) then
    raise exception 'ENVIVO_CLOSED' using errcode = 'P0001';
  end if;
  if p_adult is not true then
    raise exception 'ADULT_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_name) < 3 or length(v_name) > 80 then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  v_ig := split_part(split_part(v_ig, '/', 1), '?', 1);
  if v_ig !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'INVALID_INSTAGRAM' using errcode = 'P0001';
  end if;
  if length(v_phone) < 8 or length(v_phone) > 15 then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;

  -- Si ya envió, no se duplica: se devuelve la que ya tiene.
  select * into v_existing from public.envivo_requests
   where event_id = p_event_id and phone = v_phone
   order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'existing', true);
  end if;

  -- Freno contra spam: demasiadas en la cola sin revisar.
  if (select count(*) from public.envivo_requests
       where event_id = p_event_id and status = 'pending') >= 200 then
    raise exception 'BUSY' using errcode = 'P0001';
  end if;

  insert into public.envivo_requests (event_id, full_name, instagram, phone, adult_accepted_at)
  values (p_event_id, v_name, v_ig, v_phone, now())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pending', 'existing', false);
end;
$$;
revoke all on function public.envivo_submit(uuid, text, text, text, boolean) from public;
grant execute on function public.envivo_submit(uuid, text, text, text, boolean) to anon, authenticated;

-- -------------------------------------------------------------------------
-- 4) CURADOR
-- -------------------------------------------------------------------------
create or replace function public.envivo_set_open(p_event_id uuid, p_open boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_staff_role('curador', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  insert into public.envivo_settings (event_id, open, updated_at)
  values (p_event_id, coalesce(p_open, false), now())
  on conflict (event_id) do update set open = excluded.open, updated_at = now();
  return coalesce(p_open, false);
end;
$$;
revoke all on function public.envivo_set_open(uuid, boolean) from public, anon;
grant execute on function public.envivo_set_open(uuid, boolean) to authenticated;

-- Cola en vivo: pendientes (más antiguas primero) + contadores.
create or replace function public.envivo_queue(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_staff_role('curador', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'open', coalesce((select open from public.envivo_settings where event_id = p_event_id), false),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.full_name, 'instagram', r.instagram,
               'phone', r.phone, 'createdAt', r.created_at) order by r.created_at)
        from public.envivo_requests r
       where r.event_id = p_event_id and r.status = 'pending'
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'pending',  (select count(*) from public.envivo_requests where event_id = p_event_id and status = 'pending'),
      'accepted', (select count(*) from public.envivo_requests where event_id = p_event_id and status = 'accepted'),
      'rejected', (select count(*) from public.envivo_requests where event_id = p_event_id and status = 'rejected'),
      'paid',     (select count(*) from public.envivo_requests where event_id = p_event_id and status = 'paid')
    )
  );
end;
$$;
revoke all on function public.envivo_queue(uuid) from public, anon;
grant execute on function public.envivo_queue(uuid) to authenticated;

-- Aceptar (crea el radicado) o rechazar.
create or replace function public.envivo_decide(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
  v_rad text;
  i int := 0;
begin
  select * into r from public.envivo_requests where id = p_id for update;
  if r.id is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.has_staff_role('curador', r.event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  if p_accept then
    loop
      v_rad := (100000 + floor(random() * 900000))::int::text;
      exit when not exists (
        select 1 from public.envivo_requests where event_id = r.event_id and radicado = v_rad
      );
      i := i + 1;
      if i > 50 then
        raise exception 'RADICADO_FAILED' using errcode = 'P0001';
      end if;
    end loop;
    update public.envivo_requests
       set status = 'accepted', radicado = v_rad, decided_by = auth.uid(), decided_at = now()
     where id = r.id;
  else
    update public.envivo_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now()
     where id = r.id;
  end if;

  return jsonb_build_object('id', r.id, 'accepted', p_accept, 'radicado', v_rad);
end;
$$;
revoke all on function public.envivo_decide(uuid, boolean) from public, anon;
grant execute on function public.envivo_decide(uuid, boolean) to authenticated;

-- Datos para el aviso por WhatsApp (lo usa la función envivo-notify).
create or replace function public.envivo_notify_info(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
begin
  select * into r from public.envivo_requests where id = p_id;
  if r.id is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.has_staff_role('curador', r.event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if r.status not in ('accepted', 'rejected') then
    raise exception 'NOT_DECIDED' using errcode = 'P0001';
  end if;
  return jsonb_build_object('name', r.full_name, 'phone', r.phone, 'status', r.status, 'radicado', r.radicado);
end;
$$;
revoke all on function public.envivo_notify_info(uuid) from public, anon;
grant execute on function public.envivo_notify_info(uuid) to authenticated;

create or replace function public.envivo_mark_notified(p_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
begin
  select * into r from public.envivo_requests where id = p_id;
  if r.id is null then
    return;
  end if;
  if auth.uid() is null or not public.has_staff_role('curador', r.event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  update public.envivo_requests
     set wa_notified_at = case when p_error is null then now() else wa_notified_at end,
         wa_error = left(p_error, 300)
   where id = p_id;
end;
$$;
revoke all on function public.envivo_mark_notified(uuid, text) from public, anon;
grant execute on function public.envivo_mark_notified(uuid, text) to authenticated;

-- -------------------------------------------------------------------------
-- 5) CAJA: solo ve a los aceptados (y a los ya cobrados)
-- -------------------------------------------------------------------------
-- Busca por nombre, IG, número o radicado. Sin texto: los últimos 40.
-- NO devuelve el radicado: la caja se lo pide a la persona y lo escribe.
create or replace function public.envivo_cash_search(p_event_id uuid, p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(trim(coalesce(p_query, '')));
  qd text := regexp_replace(lower(trim(coalesce(p_query, ''))), '\D', '', 'g');
  qi text := regexp_replace(lower(trim(coalesce(p_query, ''))), '^@', '');
begin
  if auth.uid() is null or not public.has_staff_role('caja_entradas', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(x order by ord1, ord2) from (
      select
        jsonb_build_object(
          'id', r.id, 'name', r.full_name, 'instagram', r.instagram, 'phone', r.phone,
          'status', r.status, 'tierName', r.tier_name, 'amount', r.amount, 'paidAt', r.paid_at,
          'paidByMe', r.paid_by = auth.uid(),
          'canUndo', r.status = 'paid'
                     and ((r.paid_by = auth.uid() and r.paid_at > now() - interval '10 minutes')
                          or public.has_event_access(r.event_id))
        ) as x,
        (case when r.status = 'accepted' then 0 else 1 end) as ord1,
        (- extract(epoch from coalesce(r.paid_at, r.decided_at, r.created_at))) as ord2
        from public.envivo_requests r
       where r.event_id = p_event_id
         and r.status in ('accepted', 'paid')
         and (q = ''
              or lower(r.full_name) like '%' || q || '%'
              or r.instagram like '%' || qi || '%'
              or (length(qd) >= 4 and r.phone like '%' || qd || '%')
              or (length(qd) = 6 and r.radicado = qd))
       order by ord1, ord2
       limit 40
    ) s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.envivo_cash_search(uuid, text) from public, anon;
grant execute on function public.envivo_cash_search(uuid, text) to authenticated;

-- Cobrar en efectivo: pide el radicado que muestra la persona.
create or replace function public.envivo_cash_pay(p_id uuid, p_tier_id text, p_radicado text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
  v_tier jsonb;
  v_price numeric;
begin
  select * into r from public.envivo_requests where id = p_id for update;
  if r.id is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.has_staff_role('caja_entradas', r.event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if r.status = 'paid' then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;
  if r.status <> 'accepted' then
    raise exception 'NOT_ACCEPTED' using errcode = 'P0001';
  end if;
  if regexp_replace(coalesce(p_radicado, ''), '\D', '', 'g') <> r.radicado then
    raise exception 'RADICADO_MISMATCH' using errcode = 'P0001';
  end if;

  v_tier := public.tier_json(r.event_id, p_tier_id);
  if v_tier is null then
    raise exception 'INVALID_TIER' using errcode = 'P0001';
  end if;
  if coalesce((v_tier->>'isGroupTier')::boolean, false) then
    raise exception 'INVALID_TIER' using errcode = 'P0001';
  end if;
  if public.tier_sold_out(r.event_id, p_tier_id) then
    raise exception 'TIER_SOLD_OUT' using errcode = 'P0001';
  end if;
  v_price := public.tier_price(r.event_id, p_tier_id);

  update public.envivo_requests
     set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         tier_id = p_tier_id, tier_name = v_tier->>'name', amount = v_price
   where id = r.id;

  return jsonb_build_object('name', r.full_name, 'tierName', v_tier->>'name', 'amount', v_price);
end;
$$;
revoke all on function public.envivo_cash_pay(uuid, text, text) from public, anon;
grant execute on function public.envivo_cash_pay(uuid, text, text) to authenticated;

-- Deshacer un "Cobrado" marcado por error: quien lo marcó, dentro de 10
-- minutos (un admin puede siempre). Queda registrado.
create or replace function public.envivo_cash_undo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
begin
  select * into r from public.envivo_requests where id = p_id for update;
  if r.id is null then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.has_staff_role('caja_entradas', r.event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if r.status <> 'paid' then
    raise exception 'NOT_PAID' using errcode = 'P0001';
  end if;
  if not ((r.paid_by = auth.uid() and r.paid_at > now() - interval '10 minutes')
          or public.has_event_access(r.event_id)) then
    raise exception 'UNDO_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  update public.envivo_requests
     set status = 'accepted', paid_by = null, paid_at = null,
         tier_id = null, tier_name = null, amount = null,
         undo_count = undo_count + 1, last_undo_by = auth.uid(), last_undo_at = now()
   where id = r.id;
end;
$$;
revoke all on function public.envivo_cash_undo(uuid) from public, anon;
grant execute on function public.envivo_cash_undo(uuid) to authenticated;

-- Cierre de caja de /envivo: cuánto cobró cada cajero.
create or replace function public.envivo_cash_summary(p_event_id uuid, p_only_mine boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_staff_role('caja_entradas', p_event_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'cashier', coalesce(p.full_name, p.email, '—'), 'sales', s.n, 'total', s.t) order by s.t desc)
      from (
        select paid_by, count(*) as n, coalesce(sum(amount), 0) as t
          from public.envivo_requests
         where event_id = p_event_id and status = 'paid'
           and (not coalesce(p_only_mine, true) or paid_by = auth.uid())
         group by paid_by
      ) s
      left join public.profiles p on p.id = s.paid_by
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.envivo_cash_summary(uuid, boolean) from public, anon;
grant execute on function public.envivo_cash_summary(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (si algún día quieres quitarlo):
--   drop table if exists public.envivo_requests;
--   drop table if exists public.envivo_settings;
--   drop function if exists public.envivo_open_events();
--   drop function if exists public.envivo_submit(uuid, text, text, text, boolean);
--   drop function if exists public.envivo_set_open(uuid, boolean);
--   drop function if exists public.envivo_queue(uuid);
--   drop function if exists public.envivo_decide(uuid, boolean);
--   drop function if exists public.envivo_notify_info(uuid);
--   drop function if exists public.envivo_mark_notified(uuid, text);
--   drop function if exists public.envivo_cash_search(uuid, text);
--   drop function if exists public.envivo_cash_pay(uuid, text, text);
--   drop function if exists public.envivo_cash_undo(uuid);
--   drop function if exists public.envivo_cash_summary(uuid, boolean);
-- =========================================================================
