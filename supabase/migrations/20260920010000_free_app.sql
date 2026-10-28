-- The app itself is free: the khata, the ফর্দ and the WhatsApp messages work for every shop, with
-- no trial and nothing to lose when the month ends. A plan buys the extras — khata photos read by
-- the AI beyond the few free ones, a reminder to every debtor at once, the shop's own logo and the
-- other ফর্দ designs.

-- kept (the row level security policies call it), but nothing in the khata is paid for any more
create or replace function public.shop_active() returns boolean
language sql immutable security definer set search_path = ''
as $$
  select true;
$$;

-- how many khata photos a shop may have read on our AI key each month before a plan is needed
alter table public.app_config add column if not exists free_scans integer not null default 5;

create table if not exists public.scan_usage (
  shop_id uuid not null references public.shops (id) on delete cascade,
  month text not null,                          -- 'YYYY-MM' by India's clock
  used integer not null default 0,
  primary key (shop_id, month)
);

alter table public.scan_usage enable row level security;  -- only the functions below look inside

create or replace function public.shop_month() returns text
language sql stable set search_path = ''
as $$
  select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
$$;

/**
 * Asked before a khata photo is read with our own AI key. A shop on a plan is never stopped;
 * a free shop gets app_config.free_scans a month. Returns what it has used and what it may use.
 */
create or replace function public.use_scan() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  paid_until timestamptz;
  allowance integer;
  month text := public.shop_month();
  used integer;
  premium boolean;
begin
  if auth.uid() is null then
    raise exception 'not logged in' using errcode = '42501';
  end if;
  select s.paid_until into paid_until from public.shops s where s.id = auth.uid();
  premium := paid_until is not null and paid_until > now();
  select c.free_scans into allowance from public.app_config c where c.id;
  insert into public.scan_usage (shop_id, month, used) values (auth.uid(), month, 0)
    on conflict (shop_id, month) do nothing;
  select u.used into used from public.scan_usage u where u.shop_id = auth.uid() and u.month = month for update;
  if not premium and used >= allowance then
    return jsonb_build_object('allowed', false, 'used', used, 'allowance', allowance, 'premium', premium);
  end if;
  update public.scan_usage u set used = u.used + 1
    where u.shop_id = auth.uid() and u.month = month
    returning u.used into used;
  return jsonb_build_object('allowed', true, 'used', used, 'allowance', allowance, 'premium', premium);
end;
$$;

revoke execute on function public.use_scan() from public, anon;
grant execute on function public.use_scan() to authenticated;

-- shop_status now also says how many scans are left this month
create or replace function public.shop_status() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shops;
  r public.payment_requests;
  admin boolean;
  allowance integer;
  used integer;
begin
  if auth.uid() is null then
    return null;
  end if;
  insert into public.shops (id, phone)
    select u.id, u.phone from auth.users u where u.id = auth.uid()
    on conflict (id) do nothing;
  select * into s from public.shops where id = auth.uid();
  -- the latest payment the shop told us about, so the app can say it is waiting or was refused
  select * into r from public.payment_requests
    where shop_id = auth.uid() and status <> 'cancelled'
    order by created_at desc limit 1;
  admin := public.is_admin();
  select c.free_scans into allowance from public.app_config c where c.id;
  select u.used into used from public.scan_usage u where u.shop_id = auth.uid() and u.month = public.shop_month();
  return jsonb_build_object(
    'trial_ends_at', s.trial_ends_at,
    'paid_until', s.paid_until,
    'plan', s.plan,
    'server_now', now(),
    'is_admin', admin,
    'admin_pending', case when admin then (select count(*) from public.payment_requests where status = 'pending') end,
    'scans', jsonb_build_object('used', coalesce(used, 0), 'allowance', allowance),
    'request', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'plan', r.plan, 'amount', r.amount, 'utr', r.utr, 'status', r.status,
      'note', r.note, 'created_at', r.created_at, 'decided_at', r.decided_at
    ) end
  );
end;
$$;

-- the owner can change how many free scans a month every shop gets
drop function if exists public.admin_save_config(text, text, text, text);

create or replace function public.admin_save_config(
  p_upi_id text, p_upi_name text, p_support_phone text, p_app_link text, p_free_scans integer
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.app_config
    set upi_id = btrim(coalesce(p_upi_id, '')),
        upi_name = btrim(coalesce(p_upi_name, '')),
        support_phone = regexp_replace(coalesce(p_support_phone, ''), '\D', '', 'g'),
        app_link = btrim(coalesce(p_app_link, '')),
        free_scans = greatest(0, coalesce(p_free_scans, 5))
    where id;
end;
$$;

revoke execute on function public.admin_save_config(text, text, text, text, integer) from public, anon;

-- new shops start free; no trial to run out
alter table public.shops alter column trial_ends_at set default now();

-- a plan now runs from today (or from the end of the one being renewed); there is no trial to wait out
create or replace function public.grant_plan(p_shop uuid, p_plan text) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shops;
  p public.plans;
  new_until timestamptz;
begin
  select * into s from public.shops where id = p_shop for update;
  if not found then
    raise exception 'unknown shop %', p_shop;
  end if;
  select * into p from public.plans where id = p_plan;
  if not found then
    raise exception 'unknown plan %', p_plan;
  end if;
  if s.paid_until = 'infinity' then
    return s.paid_until;
  end if;
  new_until := case
    when p.months is null then 'infinity'::timestamptz
    else greatest(now(), coalesce(s.paid_until, '-infinity')) + make_interval(months => p.months)
  end;
  update public.shops set paid_until = new_until, plan = p.id where id = p_shop;
  return new_until;
end;
$$;

-- shops made while there was still a trial shouldn't have their first paid month pushed back
update public.shops set trial_ends_at = now() where trial_ends_at > now();
