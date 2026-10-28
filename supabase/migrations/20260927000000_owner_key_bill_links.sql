-- The owner's AI key on the server, ফর্দ pictures sent as links, and backups that only the owner
-- takes.
--
-- Shopkeepers never type an AI key: the owner sets one on the অ্যাডমিন page, it is kept here where
-- no phone can read it, and every shop's khata photo is read through the "ai" function
-- (supabase/functions/ai), which adds the key on the way to Google. Each scan is counted once,
-- against the free shop's monthly scans, however many times the AI is asked during it.

-- ── the owner's AI key ──

create table if not exists public.app_secrets (
  id boolean primary key default true check (id),
  gemini_key text not null default '',
  gemini_model text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;  -- no policies: only the ai function (service role) reads it
insert into public.app_secrets default values on conflict (id) do nothing;

create or replace function public.admin_set_ai_key(p_key text, p_model text default '') returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.app_secrets
    set gemini_key = btrim(coalesce(p_key, '')),
        gemini_model = btrim(coalesce(p_model, '')),
        updated_at = now()
    where id;
end;
$$;

/** What the অ্যাডমিন page may know about the key: whether there is one, and its last four letters. */
create or replace function public.admin_ai_key() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.app_secrets;
begin
  perform public.require_admin();
  select * into s from public.app_secrets where id;
  return jsonb_build_object(
    'set', coalesce(s.gemini_key, '') <> '',
    'tail', right(coalesce(s.gemini_key, ''), 4),
    'model', coalesce(s.gemini_model, ''),
    'updated_at', s.updated_at
  );
end;
$$;

-- one scan = one ticket, however many times the AI is asked while reading it
create table if not exists public.scan_tickets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  calls integer not null default 0
);

alter table public.scan_tickets enable row level security;  -- reached only through the functions here
create index if not exists scan_tickets_shop on public.scan_tickets (shop_id, created_at);

/**
 * Called by the app before a khata photo is read on the owner's key. Counts the scan (a free shop
 * gets app_config.free_scans a month) and returns a ticket the ai function asks for.
 */
create or replace function public.start_scan() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  ticket uuid;
begin
  if auth.uid() is null then
    raise exception 'not logged in' using errcode = '42501';
  end if;
  r := public.use_scan();
  if not coalesce((r ->> 'allowed')::boolean, false) then
    return r;
  end if;
  delete from public.scan_tickets where shop_id = auth.uid() and created_at < now() - interval '1 day';
  insert into public.scan_tickets (shop_id) values (auth.uid()) returning id into ticket;
  return r || jsonb_build_object('ticket', ticket);
end;
$$;

/**
 * For the ai function only: is this a fresh ticket of this shop? Then the key (and the model the
 * owner chose, if any). A scan may ask the AI a few times (a busy model, a second model), not more.
 */
create or replace function public.ai_ticket(p_ticket uuid, p_shop uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.scan_tickets;
  s public.app_secrets;
begin
  select * into t from public.scan_tickets where id = p_ticket for update;
  if not found or t.shop_id <> p_shop or t.created_at < now() - interval '20 minutes' or t.calls >= 16 then
    return null;
  end if;
  update public.scan_tickets set calls = calls + 1 where id = p_ticket;
  select * into s from public.app_secrets where id;
  return jsonb_build_object('key', coalesce(s.gemini_key, ''), 'model', coalesce(s.gemini_model, ''));
end;
$$;

revoke execute on function public.admin_set_ai_key(text, text) from public, anon;
revoke execute on function public.admin_ai_key() from public, anon;
revoke execute on function public.start_scan() from public, anon;
grant execute on function public.start_scan() to authenticated;
revoke execute on function public.ai_ticket(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_ticket(uuid, uuid) to service_role;

-- shop_status also says whether reading khata photos is switched on
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
    'ai_ready', exists (select 1 from public.app_secrets k where k.id and k.gemini_key <> ''),
    'request', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'plan', r.plan, 'amount', r.amount, 'utr', r.utr, 'status', r.status,
      'note', r.note, 'created_at', r.created_at, 'decided_at', r.decided_at
    ) end
  );
end;
$$;

-- ── ফর্দ pictures, sent to customers as links ──

-- Public: WhatsApp and the customer's phone open them without logging in. Each is named by 22
-- random letters, so nobody can guess another shop's ফর্দ.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bills', 'bills', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "shops add bill pictures" on storage.objects;
create policy "shops add bill pictures" on storage.objects for insert to authenticated
  with check (bucket_id = 'bills' and name ~ '^[A-Za-z0-9_-]{16,40}(-og\.jpg|\.png)$');

-- ── backups are the owner's ──

/** One shop's whole khata, for the owner to keep a copy of. */
create or replace function public.admin_shop_backup(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'shop', (select jsonb_build_object('id', s.id, 'phone', s.phone, 'created_at', s.created_at, 'paid_until', s.paid_until, 'plan', s.plan)
             from public.shops s where s.id = p_shop),
    'settings', (select ss.data from public.shop_settings ss where ss.shop_id = p_shop),
    'customers', coalesce((select jsonb_agg(to_jsonb(c) - 'shop_id' order by c.created_at)
                           from public.customers c where c.shop_id = p_shop and not c.deleted), '[]'::jsonb),
    'txns', coalesce((select jsonb_agg(to_jsonb(t) - 'shop_id' order by t.date, t.created_at)
                      from public.txns t where t.shop_id = p_shop and not t.deleted), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_shop_backup(uuid) from public, anon;
