-- =========================================================================
-- 403 · EN VIVO → ENTRADA REAL
--
-- Antes: los aceptados de /envivo vivían solo en envivo_requests. King no
-- los veía, y al cobrarlos en /cobrar NO se creaba ninguna entrada, así que
-- el aforo de las localidades nunca bajaba.
--
-- Ahora:
--   1) Al ACEPTAR en /curador se crea su solicitud APROBADA en King
--      (access_requests) para esa ciudad. Así aparece en Solicitudes y
--      queda como "aceptado" para los próximos eventos.
--   2) Al COBRAR en /cobrar se crea su ENTRADA (purchased_tickets) ya
--      pagada en efectivo, con QR, que DESCUENTA el aforo de la localidad,
--      sale en King → Compras y la puerta la encuentra por su nombre.
--      Si la persona ya tiene cuenta 403 con ese número, la entrada le
--      aparece también en su cuenta.
--   3) Deshacer un cobro anula esa entrada (el cupo vuelve a quedar libre).
--   4) La caja ve las localidades con los cupos que quedan de verdad
--      (envivo_tiers), y no deja vender si están agotadas.
--   5) Se pasan los aceptados y cobrados que ya existían.
--
-- REQUISITO: haber corrido migration-envivo.sql y migration-barra-caja.sql.
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Es seguro volver a ejecutarlo.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0) Columnas nuevas
-- -------------------------------------------------------------------------
-- Una entrada de puerta puede no tener cuenta 403 (la persona solo dio
-- nombre, IG y número). La puerta la busca por nombre.
alter table public.purchased_tickets alter column user_id drop not null;
alter table public.events add column if not exists archived boolean not null default false;

alter table public.purchased_tickets
  add column if not exists envivo_request_id uuid references public.envivo_requests(id) on delete set null;

alter table public.envivo_requests
  add column if not exists access_request_id uuid references public.access_requests(id) on delete set null,
  add column if not exists ticket_id uuid references public.purchased_tickets(id) on delete set null;

create index if not exists purchased_tickets_envivo_idx on public.purchased_tickets (envivo_request_id);

-- -------------------------------------------------------------------------
-- 1) Utilidades
-- -------------------------------------------------------------------------
-- Cuenta 403 con el mismo número (se comparan los últimos 9 dígitos).
create or replace function public.envivo_profile_for_phone(p_phone text)
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
    from public.profiles p
   where length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
     and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9)
         = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9)
   order by (p.role = 'guest') desc, p.created_at desc
   limit 1;
$$;
revoke all on function public.envivo_profile_for_phone(text) from public, anon, authenticated;

-- Crea (una sola vez) la solicitud aprobada en King para un aceptado.
create or replace function public.envivo_ensure_access_request(p_id uuid, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
  v_prof public.profiles;
  v_city text;
  v_ar uuid;
begin
  select * into r from public.envivo_requests where id = p_id;
  if r.id is null or r.status not in ('accepted', 'paid') then
    return null;
  end if;
  if r.access_request_id is not null
     and exists (select 1 from public.access_requests where id = r.access_request_id) then
    return r.access_request_id;
  end if;

  v_prof := public.envivo_profile_for_phone(r.phone);
  select city into v_city from public.events where id = r.event_id;

  -- ¿Ya tiene una solicitud para esta ciudad (por correo de su cuenta o
  -- por número)? Se aprueba esa en vez de crear otra.
  select ar.id into v_ar
    from public.access_requests ar
   where ar.event_id = r.event_id
     and (
       (v_prof.id is not null and lower(ar.email) = lower(v_prof.email))
       or right(regexp_replace(coalesce(ar.phone, ''), '\D', '', 'g'), 9) = right(r.phone, 9)
     )
   order by (ar.status = 'approved') desc, ar.created_at desc
   limit 1;

  if v_ar is not null then
    update public.access_requests
       set status = 'approved',
           approved_at = coalesce(approved_at, coalesce(r.decided_at, now()))
     where id = v_ar and status <> 'approved';
  else
    insert into public.access_requests (
      full_name, city, email, phone, instagram, status, event_id,
      approved_at, applicant_is_adult, consented_at, reviewed_by
    ) values (
      r.full_name, coalesce(v_city, ''), coalesce(v_prof.email, ''), '+' || r.phone, r.instagram,
      'approved', r.event_id,
      coalesce(r.decided_at, now()), true, r.adult_accepted_at,
      (select id from public.profiles where id = p_by)
    )
    returning id into v_ar;
  end if;

  update public.envivo_requests set access_request_id = v_ar where id = r.id;
  return v_ar;
end;
$$;
revoke all on function public.envivo_ensure_access_request(uuid, uuid) from public, anon, authenticated;

-- Crea la entrada pagada (con QR) de un cobro de /envivo. Sin revisar
-- aforo: eso lo hace quien la llama.
create or replace function public.envivo_issue_ticket(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
  v_prof public.profiles;
  v_event public.events;
  v_tier jsonb;
  v_ticket uuid;
  v_sub text;
  v_claims text;
begin
  select * into r from public.envivo_requests where id = p_id;
  if r.id is null or r.status <> 'paid' or r.tier_id is null then
    return null;
  end if;
  if r.ticket_id is not null
     and exists (select 1 from public.purchased_tickets where id = r.ticket_id and status <> 'rejected') then
    return r.ticket_id;
  end if;

  v_prof := public.envivo_profile_for_phone(r.phone);
  select * into v_event from public.events where id = r.event_id;
  v_tier := public.tier_json(r.event_id, r.tier_id);

  -- Las reglas de la compra web (dueño, precio, aprobación…) no aplican a
  -- un cobro en la puerta: se inserta como proceso del servidor y se
  -- vuelve a la sesión del cajero apenas termina.
  v_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);

  insert into public.purchased_tickets (
    user_id, buyer_name, buyer_email, ticket_tier, tier_name, quantity, unit_price, discount_applied,
    total_price, currency, qr_payload, status, event_id, paid_cash, cash_collected_by, courtesy_note,
    envivo_request_id, purchase_date
  ) values (
    v_prof.id, r.full_name, coalesce(v_prof.email, ''), r.tier_id,
    coalesce(r.tier_name, v_tier->>'name', r.tier_id), 1,
    coalesce(r.amount, 0), 0, coalesce(r.amount, 0), coalesce(v_event.currency, 'USD'),
    'PENDING_SERVER_QR', 'pending_verification', r.event_id, true, r.paid_by,
    'En vivo · radicado ' || coalesce(r.radicado, '—') || ' · +' || r.phone || ' · @' || r.instagram,
    r.id, coalesce(r.paid_at, now())
  )
  returning id into v_ticket;
  -- Al pasar a 'valid' el trigger de siempre le genera su QR.
  update public.purchased_tickets set status = 'valid' where id = v_ticket;

  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  update public.envivo_requests set ticket_id = v_ticket where id = r.id;
  return v_ticket;
end;
$$;
revoke all on function public.envivo_issue_ticket(uuid) from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- 2) Localidades con cupos reales (para /caja y /cobrar)
-- -------------------------------------------------------------------------
create or replace function public.envivo_tiers(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not (public.has_staff_role('caja_entradas', p_event_id) or public.has_staff_role('curador', p_event_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(x order by ord)
      from (
        select ord,
               jsonb_build_object(
                 'id', t->>'id',
                 'name', t->>'name',
                 'price', public.tier_price(p_event_id, t->>'id'),
                 'isGroupTier', coalesce((t->>'isGroupTier')::boolean, false),
                 'groupSize', greatest(1, coalesce(nullif(t->>'groupSize', '')::int, 1)),
                 'exclusive', coalesce((t->>'exclusive')::boolean, false),
                 'capacity', cap,
                 'sold', sold,
                 'available', case when cap > 0 then greatest(0, cap - sold - held) end,
                 'soldOut', coalesce((t->>'soldOut')::boolean, false)
                            or (cap > 0 and cap - sold - held <= 0)
               ) as x
          from (
            select t, ord,
                   public.tier_capacity(p_event_id, t->>'id') as cap,
                   public.tier_sold_quantity_for(p_event_id, t->>'id', null) as sold,
                   public.tier_held_seats(p_event_id, t->>'id', null) as held
              from public.events e,
                   jsonb_array_elements(coalesce(e.ticket_tiers, '[]'::jsonb)) with ordinality as a(t, ord)
             where e.id = p_event_id
          ) s
      ) z
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.envivo_tiers(uuid) from public, anon;
grant execute on function public.envivo_tiers(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 3) CURADOR: aceptar ahora también crea la solicitud aprobada en King
-- -------------------------------------------------------------------------
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
    perform public.envivo_ensure_access_request(r.id, auth.uid());
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

-- -------------------------------------------------------------------------
-- 4) CAJA: cobrar crea la entrada y respeta el aforo
-- -------------------------------------------------------------------------
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
  v_cap int;
  v_ticket uuid;
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
  if v_tier is null or coalesce((v_tier->>'isGroupTier')::boolean, false) then
    raise exception 'INVALID_TIER' using errcode = 'P0001';
  end if;
  if public.tier_sold_out(r.event_id, p_tier_id) then
    raise exception 'TIER_SOLD_OUT' using errcode = 'P0001';
  end if;

  -- Aforo: dos cajas cobrando a la vez no pueden pasarse del cupo.
  perform pg_advisory_xact_lock(hashtext('tier:' || r.event_id::text || ':' || p_tier_id));
  v_cap := public.tier_capacity(r.event_id, p_tier_id);
  if v_cap > 0 and public.tier_sold_quantity_for(r.event_id, p_tier_id, null)
                   + public.tier_held_seats(r.event_id, p_tier_id, null) + 1 > v_cap then
    raise exception 'TIER_SOLD_OUT' using errcode = 'P0001';
  end if;
  v_price := public.tier_price(r.event_id, p_tier_id);

  update public.envivo_requests
     set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         tier_id = p_tier_id, tier_name = v_tier->>'name', amount = v_price
   where id = r.id;

  perform public.envivo_ensure_access_request(r.id, auth.uid());
  v_ticket := public.envivo_issue_ticket(r.id);

  return jsonb_build_object('name', r.full_name, 'tierName', v_tier->>'name', 'amount', v_price, 'ticketId', v_ticket);
end;
$$;
revoke all on function public.envivo_cash_pay(uuid, text, text) from public, anon;
grant execute on function public.envivo_cash_pay(uuid, text, text) to authenticated;

-- Deshacer: la entrada queda anulada y el cupo vuelve a estar libre.
create or replace function public.envivo_cash_undo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.envivo_requests;
  v_sub text;
  v_claims text;
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
  if exists (select 1 from public.purchased_tickets
              where envivo_request_id = r.id and status = 'used') then
    raise exception 'ALREADY_CHECKED_IN' using errcode = 'P0001';
  end if;

  v_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  update public.purchased_tickets
     set status = 'rejected'
   where envivo_request_id = r.id and status in ('valid', 'pending_verification');
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  update public.envivo_requests
     set status = 'accepted', paid_by = null, paid_at = null,
         tier_id = null, tier_name = null, amount = null, ticket_id = null,
         undo_count = undo_count + 1, last_undo_by = auth.uid(), last_undo_at = now()
   where id = r.id;
end;
$$;
revoke all on function public.envivo_cash_undo(uuid) from public, anon;
grant execute on function public.envivo_cash_undo(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 5) Finanzas: los cobros de /envivo ya son entradas (purchased_tickets).
--    Aquí solo se suman los cobros viejos que no tienen entrada, para no
--    contarlos dos veces.
-- -------------------------------------------------------------------------
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
       where status = 'paid' and ticket_id is null
       group by event_id
    ) s
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.finance_envivo_totals() to authenticated;

-- -------------------------------------------------------------------------
-- 6) Pasar lo que ya existía
-- -------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id, decided_by from public.envivo_requests
            where status in ('accepted', 'paid') and access_request_id is null loop
    perform public.envivo_ensure_access_request(r.id, r.decided_by);
  end loop;
  -- Solo eventos activos: lo de eventos archivados no se toca.
  for r in select er.id from public.envivo_requests er
             join public.events e on e.id = er.event_id
            where er.status = 'paid' and er.ticket_id is null
              and coalesce(e.archived, false) = false loop
    perform public.envivo_issue_ticket(r.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK: volver a correr migration-envivo.sql y
-- migration-barra-anular-finanzas.sql (las entradas creadas se quedan).
-- =========================================================================
