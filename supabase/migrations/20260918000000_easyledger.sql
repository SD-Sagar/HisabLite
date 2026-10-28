-- EasyLedger: one shop per login (mobile number + password). Every row carries its shop's id and
-- row level security keeps each shop to its own rows. Phones sync offline-first: they upsert their
-- changes and pull everything whose synced_at moved since they last looked.
--
-- Plans are paid by UPI straight to the app's owner, who checks the money and turns the plan on
-- from the app's অ্যাডমিন page (payment_requests and the admin_* functions). Razorpay (orders,
-- payments, apply_payment and supabase/functions) is kept for later and not in use yet.

-- ── shops and the free trial ──

create table public.shops (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  created_at timestamptz not null default now(),
  -- a month free for every new phone number
  trial_ends_at timestamptz not null default now() + interval '30 days',
  -- null = never paid; 'infinity' = lifetime plan
  paid_until timestamptz,
  plan text
);

alter table public.shops enable row level security;
-- read-only for the shop itself: the trial and plan dates change only through grant_plan
create policy "shop reads itself" on public.shops for select to authenticated using (id = auth.uid());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.shops (id, phone) values (new.id, new.phone) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- true while the shop's trial or plan runs; writes to the khata need it
create or replace function public.shop_active() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shops s
    where s.id = auth.uid()
      and greatest(s.trial_ends_at, coalesce(s.paid_until, '-infinity')) > now()
  );
$$;

-- ── the people who run EasyLedger ──

-- They see every shop, check UPI payments and turn plans on. Add one (after they have made a
-- shop in the app with their own number):
--   insert into public.admins (user_id) select id from auth.users where phone = '91XXXXXXXXXX';
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.admins enable row level security;  -- no policies: only is_admin() looks inside

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
end;
$$;

-- where shopkeepers send the money and whom they WhatsApp; one row, edited on the অ্যাডমিন page
create table public.app_config (
  id boolean primary key default true check (id),
  upi_id text not null default '',
  upi_name text not null default '',
  support_phone text not null default ''        -- digits with the country code, as wa.me wants
);

alter table public.app_config enable row level security;
-- the login screen shows the WhatsApp number to shops that forgot their password
create policy "anyone reads the app config" on public.app_config for select using (true);
insert into public.app_config default values;

-- ── plans ──

-- prices can be changed here without touching the app
create table public.plans (
  id text primary key,
  price integer not null check (price > 0),     -- rupees
  months integer check (months > 0),            -- null = lifetime
  sort integer not null default 0,
  active boolean not null default true
);

alter table public.plans enable row level security;
create policy "anyone reads plans" on public.plans for select using (true);

insert into public.plans (id, price, months, sort) values
  ('monthly', 299, 1, 1),
  ('yearly', 1450, 12, 2),
  ('lifetime', 5000, null, 3);

-- Extends a shop's plan. One bought during the trial, or before the last plan ends, starts when
-- that ends, so no day already paid for is lost. Lifetime stays lifetime.
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
    else greatest(now(), s.trial_ends_at, coalesce(s.paid_until, '-infinity')) + make_interval(months => p.months)
  end;
  update public.shops set paid_until = new_until, plan = p.id where id = p_shop;
  return new_until;
end;
$$;

revoke execute on function public.grant_plan(uuid, text) from public, anon, authenticated;

-- ── UPI payments, checked by hand ──

-- A shopkeeper who paid by UPI says so here. The owner matches it with the money received, then
-- approves it (the plan starts) or rejects it with a reason the shopkeeper sees.
create table public.payment_requests (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  plan text not null references public.plans (id),
  amount integer not null,                      -- rupees: the plan's price when asked
  utr text not null default '',                 -- UPI reference number, if the shopkeeper gave it
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text not null default '',                -- the owner's reason when rejecting
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  paid_until timestamptz                        -- where the approval took the plan
);

create unique index payment_requests_one_pending on public.payment_requests (shop_id) where status = 'pending';
create index payment_requests_waiting on public.payment_requests (created_at) where status = 'pending';

alter table public.payment_requests enable row level security;
create policy "shop reads its requests" on public.payment_requests for select to authenticated using (shop_id = auth.uid());

-- "I have paid for this plan". Sending another while one waits replaces it.
create or replace function public.request_plan(p_plan text, p_utr text default '') returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  p public.plans;
  new_id bigint;
begin
  if auth.uid() is null then
    raise exception 'not logged in' using errcode = '42501';
  end if;
  select * into p from public.plans where id = p_plan and active;
  if not found then
    raise exception 'unknown plan %', p_plan;
  end if;
  update public.payment_requests set status = 'cancelled', decided_at = now()
    where shop_id = auth.uid() and status = 'pending';
  insert into public.payment_requests (shop_id, plan, amount, utr)
    values (auth.uid(), p.id, p.price, left(btrim(coalesce(p_utr, '')), 40))
    returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.request_plan(text, text) from public, anon;
grant execute on function public.request_plan(text, text) to authenticated;

-- The app asks this after login and on every sync. It also makes the shop row if it is missing.
create or replace function public.shop_status() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.shops;
  r public.payment_requests;
  admin boolean;
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
  return jsonb_build_object(
    'trial_ends_at', s.trial_ends_at,
    'paid_until', s.paid_until,
    'plan', s.plan,
    'server_now', now(),
    'is_admin', admin,
    'admin_pending', case when admin then (select count(*) from public.payment_requests where status = 'pending') end,
    'request', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'plan', r.plan, 'amount', r.amount, 'utr', r.utr, 'status', r.status,
      'note', r.note, 'created_at', r.created_at, 'decided_at', r.decided_at
    ) end
  );
end;
$$;

revoke execute on function public.shop_status() from public, anon;
grant execute on function public.shop_status() to authenticated;

-- ── the অ্যাডমিন page ──

-- payments waiting to be checked, oldest first
create or replace function public.admin_requests()
returns table (
  id bigint, shop_id uuid, phone text, shop_name text, plan text, amount integer, utr text, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
    select r.id, r.shop_id, s.phone, coalesce(ss.data ->> 'shopName', ''), r.plan, r.amount, r.utr, r.created_at
    from public.payment_requests r
    join public.shops s on s.id = r.shop_id
    left join public.shop_settings ss on ss.shop_id = r.shop_id
    where r.status = 'pending'
    order by r.created_at;
end;
$$;

-- every shop, newest first; p_search matches the number or the shop's name
create or replace function public.admin_shops(p_search text default '')
returns table (
  id uuid, phone text, shop_name text, created_at timestamptz,
  trial_ends_at timestamptz, paid_until timestamptz, plan text, waiting boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  words text := btrim(coalesce(p_search, ''));
  digits text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
begin
  perform public.require_admin();
  return query
    select s.id, s.phone, coalesce(ss.data ->> 'shopName', ''), s.created_at,
           s.trial_ends_at, s.paid_until, s.plan,
           exists (select 1 from public.payment_requests r where r.shop_id = s.id and r.status = 'pending')
    from public.shops s
    left join public.shop_settings ss on ss.shop_id = s.id
    where words = ''
       or (digits <> '' and s.phone like '%' || digits || '%')
       or coalesce(ss.data ->> 'shopName', '') ilike '%' || words || '%'
    order by s.created_at desc
    limit 200;
end;
$$;

-- the money came (the plan starts) or it didn't (the shopkeeper sees p_note)
create or replace function public.admin_decide(p_request bigint, p_approve boolean, p_note text default '')
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  r public.payment_requests;
  new_until timestamptz;
begin
  perform public.require_admin();
  select * into r from public.payment_requests where id = p_request for update;
  if not found or r.status <> 'pending' then
    raise exception 'payment % is not waiting', p_request;
  end if;
  if p_approve then
    new_until := public.grant_plan(r.shop_id, r.plan);
  end if;
  update public.payment_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        note = left(btrim(coalesce(p_note, '')), 200),
        decided_at = now(),
        paid_until = new_until
    where id = r.id;
  return new_until;
end;
$$;

-- a plan paid some other way (cash) or given free; kept in payment_requests as already approved
create or replace function public.admin_grant(p_shop uuid, p_plan text) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_price integer;
  new_until timestamptz;
begin
  perform public.require_admin();
  select p.price into v_price from public.plans p where p.id = p_plan;
  if not found then
    raise exception 'unknown plan %', p_plan;
  end if;
  -- a payment the shop was waiting on is taken to be this one
  update public.payment_requests set status = 'cancelled', decided_at = now()
    where shop_id = p_shop and status = 'pending';
  new_until := public.grant_plan(p_shop, p_plan);
  insert into public.payment_requests (shop_id, plan, amount, status, decided_at, paid_until)
    values (p_shop, p_plan, v_price, 'approved', now(), new_until);
  return new_until;
end;
$$;

-- for a shopkeeper who forgot the password (there is no SMS or email to reset it with)
create or replace function public.admin_set_password(p_shop uuid, p_password text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'password too short' using errcode = '22023';
  end if;
  update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
    where id = p_shop;
  if not found then
    raise exception 'unknown shop %', p_shop;
  end if;
end;
$$;

create or replace function public.admin_save_config(p_upi_id text, p_upi_name text, p_support_phone text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.app_config
    set upi_id = btrim(coalesce(p_upi_id, '')),
        upi_name = btrim(coalesce(p_upi_name, '')),
        support_phone = regexp_replace(coalesce(p_support_phone, ''), '\D', '', 'g')
    where id;
end;
$$;

revoke execute on function public.require_admin() from public, anon;
revoke execute on function public.admin_requests() from public, anon;
revoke execute on function public.admin_shops(text) from public, anon;
revoke execute on function public.admin_decide(bigint, boolean, text) from public, anon;
revoke execute on function public.admin_grant(uuid, text) from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
revoke execute on function public.admin_save_config(text, text, text) from public, anon;

-- ── Razorpay (for later) ──

-- orders and payments; only the server functions (service role) write them
create table public.orders (
  id text primary key,                          -- Razorpay order id
  shop_id uuid not null references public.shops (id) on delete cascade,
  plan text not null references public.plans (id),
  amount integer not null,                      -- paise
  status text not null default 'created' check (status in ('created', 'paid')),
  created_at timestamptz not null default now()
);

create table public.payments (
  id text primary key,                          -- Razorpay payment id
  shop_id uuid not null references public.shops (id) on delete cascade,
  order_id text not null references public.orders (id),
  plan text not null,
  amount integer not null,                      -- paise
  paid_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.payments enable row level security;
create policy "shop reads its payments" on public.payments for select to authenticated using (shop_id = auth.uid());

-- Marks an order paid and extends the shop's plan. Safe to call twice for the same payment
-- (the checkout and Razorpay's webhook both do).
create or replace function public.apply_payment(p_order_id text, p_payment_id text) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  new_until timestamptz;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'unknown order %', p_order_id;
  end if;
  if o.status = 'paid' then
    return (select s.paid_until from public.shops s where s.id = o.shop_id);
  end if;
  new_until := public.grant_plan(o.shop_id, o.plan);
  update public.orders set status = 'paid' where id = o.id;
  insert into public.payments (id, shop_id, order_id, plan, amount, paid_until)
    values (p_payment_id, o.shop_id, o.id, o.plan, o.amount, new_until)
    on conflict (id) do nothing;
  return new_until;
end;
$$;

revoke execute on function public.apply_payment(text, text) from public, anon, authenticated;

-- ── the khata ──

create table public.customers (
  id uuid primary key,                          -- made on the phone, so it works offline
  shop_id uuid not null default auth.uid() references public.shops (id) on delete cascade,
  name text not null,
  phone text not null default '',
  address text not null default '',
  opening_balance numeric(14, 2) not null default 0,
  created_at bigint not null,                   -- ms since 1970, the phone's clock
  updated_at bigint not null,
  deleted boolean not null default false,
  synced_at timestamptz not null default clock_timestamp()
);

create table public.txns (
  id uuid primary key,
  shop_id uuid not null default auth.uid() references public.shops (id) on delete cascade,
  customer_id uuid not null,
  no integer,                                   -- ফর্দ number
  date date not null,
  type text not null check (type in ('sale', 'payment')),
  items jsonb not null default '[]',
  total numeric(14, 2) not null default 0,
  paid numeric(14, 2) not null default 0,
  note text not null default '',
  source text not null default 'manual' check (source in ('manual', 'scan')),
  image_id uuid,                                -- photo at khata/<shop>/<image_id>.jpg
  created_at bigint not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  synced_at timestamptz not null default clock_timestamp()
);

-- shop name, messages, ফর্দ design (never the AI keys, never the phone's language)
create table public.shop_settings (
  shop_id uuid primary key default auth.uid() references public.shops (id) on delete cascade,
  data jsonb not null,
  updated_at bigint not null,
  synced_at timestamptz not null default clock_timestamp()
);

create index customers_shop_synced on public.customers (shop_id, synced_at);
create index txns_shop_synced on public.txns (shop_id, synced_at);

-- Every write moves synced_at, which is what phones pull by. A write older than what the
-- server has (an offline phone catching up late) is dropped, so the newest edit wins.
create or replace function public.touch_synced_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

create trigger touch before insert or update on public.customers
  for each row execute function public.touch_synced_at();
create trigger touch before insert or update on public.txns
  for each row execute function public.touch_synced_at();
create trigger touch before insert or update on public.shop_settings
  for each row execute function public.touch_synced_at();

alter table public.customers enable row level security;
alter table public.txns enable row level security;
alter table public.shop_settings enable row level security;

-- the khata can always be read; it can be changed only while the trial or a plan runs
create policy "read own customers" on public.customers for select to authenticated using (shop_id = auth.uid());
create policy "add own customers" on public.customers for insert to authenticated
  with check (shop_id = auth.uid() and public.shop_active());
create policy "change own customers" on public.customers for update to authenticated
  using (shop_id = auth.uid()) with check (shop_id = auth.uid() and public.shop_active());

create policy "read own txns" on public.txns for select to authenticated using (shop_id = auth.uid());
create policy "add own txns" on public.txns for insert to authenticated
  with check (shop_id = auth.uid() and public.shop_active());
create policy "change own txns" on public.txns for update to authenticated
  using (shop_id = auth.uid()) with check (shop_id = auth.uid() and public.shop_active());

-- settings stay editable after a plan ends: they don't touch the khata
create policy "read own settings" on public.shop_settings for select to authenticated using (shop_id = auth.uid());
create policy "add own settings" on public.shop_settings for insert to authenticated with check (shop_id = auth.uid());
create policy "change own settings" on public.shop_settings for update to authenticated
  using (shop_id = auth.uid()) with check (shop_id = auth.uid());

-- ── khata photos ──

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('khata', 'khata', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'khata' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "add own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'khata' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own photos" on storage.objects for update to authenticated
  using (bucket_id = 'khata' and (storage.foldername(name))[1] = auth.uid()::text);
