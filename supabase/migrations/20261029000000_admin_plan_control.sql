-- Migration: Admin plan control & shop management
-- Adds admin_revoke, fixes admin_grant to allow switching away from lifetime,
-- and adds admin_update_shop_name.

-- 1. admin_revoke: Cancels plan and resets shop back to free
create or replace function public.admin_revoke(p_shop uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  
  -- Cancel any pending payment requests
  update public.payment_requests
    set status = 'cancelled', decided_at = now()
    where shop_id = p_shop and status = 'pending';

  -- Reset paid status on shop
  update public.shops
    set paid_until = null, plan = null
    where id = p_shop;

  if not found then
    raise exception 'unknown shop %', p_shop;
  end if;
end;
$$;

revoke execute on function public.admin_revoke(uuid) from public, anon;
grant execute on function public.admin_revoke(uuid) to authenticated;


-- 2. admin_grant: Overrides plan cleanly, even if previously lifetime
create or replace function public.admin_grant(p_shop uuid, p_plan text) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shops;
  p public.plans;
  v_price integer;
  new_until timestamptz;
begin
  perform public.require_admin();

  select * into s from public.shops where id = p_shop for update;
  if not found then
    raise exception 'unknown shop %', p_shop;
  end if;

  select * into p from public.plans where id = p_plan;
  if not found then
    raise exception 'unknown plan %', p_plan;
  end if;

  -- Calculate new expiration
  if p.months is null then
    new_until := 'infinity'::timestamptz;
  else
    -- If shop already had an active non-lifetime plan of the SAME kind, extend it;
    -- otherwise, if switching plans or starting fresh, start from now.
    if s.plan = p_plan and s.paid_until is not null and s.paid_until > now() and s.paid_until <> 'infinity' then
      new_until := s.paid_until + make_interval(months => p.months);
    else
      new_until := now() + make_interval(months => p.months);
    end if;
  end if;

  -- Cancel pending payment requests
  update public.payment_requests
    set status = 'cancelled', decided_at = now()
    where shop_id = p_shop and status = 'pending';

  -- Update shop plan
  update public.shops
    set paid_until = new_until, plan = p_plan
    where id = p_shop;

  -- Insert payment request record as approved
  v_price := coalesce(p.price, 0);
  insert into public.payment_requests (shop_id, plan, amount, status, decided_at, paid_until)
    values (p_shop, p_plan, v_price, 'approved', now(), new_until);

  return new_until;
end;
$$;

revoke execute on function public.admin_grant(uuid, text) from public, anon;
grant execute on function public.admin_grant(uuid, text) to authenticated;


-- 3. admin_update_shop_name: Allows admin to update shop name in shop_settings
create or replace function public.admin_update_shop_name(p_shop uuid, p_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cur_data jsonb;
begin
  perform public.require_admin();

  select data into cur_data from public.shop_settings where shop_id = p_shop;
  if cur_data is null then
    cur_data := '{}'::jsonb;
  end if;

  cur_data := jsonb_set(cur_data, '{shopName}', to_jsonb(btrim(coalesce(p_name, ''))));

  insert into public.shop_settings (shop_id, data, updated_at)
    values (p_shop, cur_data, (extract(epoch from now()) * 1000)::bigint)
    on conflict (shop_id) do update
    set data = excluded.data, updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.admin_update_shop_name(uuid, text) from public, anon;
grant execute on function public.admin_update_shop_name(uuid, text) to authenticated;


-- 4. Enable Supabase Realtime for instant reflection across devices
alter table public.shops replica identity full;
alter table public.shop_settings replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.shops;
    exception when others then null;
    end;
    begin
      alter publication supabase_realtime add table public.shop_settings;
    exception when others then null;
    end;
    begin
      alter publication supabase_realtime add table public.payment_requests;
    exception when others then null;
    end;
  end if;
end;
$$;

