-- A customer's own khata, on a link (premium). The shopkeeper sends it on WhatsApp; the customer
-- opens it without logging in and sees exactly what the shop's khata says — which is what stops
-- the "আমি এত নিইনি" argument.

alter table public.app_config add column if not exists web_url text not null default '';

create table if not exists public.khata_shares (
  token text primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid not null,
  created_at timestamptz not null default now(),
  unique (shop_id, customer_id)
);

alter table public.khata_shares enable row level security;  -- reached only through the functions here

/** The link for one customer, made the first time it is asked for. Needs a plan. */
create or replace function public.share_khata(p_customer uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  paid_until timestamptz;
  token text;
begin
  if auth.uid() is null then
    raise exception 'not logged in' using errcode = '42501';
  end if;
  select s.paid_until into paid_until from public.shops s where s.id = auth.uid();
  if paid_until is null or paid_until <= now() then
    raise exception 'this needs a plan' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.shop_id = auth.uid() and not c.deleted) then
    raise exception 'unknown customer' using errcode = '42501';
  end if;
  select k.token into token from public.khata_shares k where k.shop_id = auth.uid() and k.customer_id = p_customer;
  if token is null then
    -- short, hard to guess, and safe inside a web address
    token := replace(replace(replace(encode(extensions.gen_random_bytes(12), 'base64'), '+', '-'), '/', '_'), '=', '');
    insert into public.khata_shares (token, shop_id, customer_id) values (token, auth.uid(), p_customer);
  end if;
  return token;
end;
$$;

/** Takes the link back: it stops working at once. */
create or replace function public.stop_sharing(p_customer uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not logged in' using errcode = '42501';
  end if;
  delete from public.khata_shares where shop_id = auth.uid() and customer_id = p_customer;
end;
$$;

/**
 * What the customer sees: the shop's name, their own name, what they owe now and every entry.
 * Open to anyone holding the link, which is the whole point, so it gives nothing else away —
 * no phone numbers, no other customer, nothing to write.
 */
create or replace function public.khata_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  k public.khata_shares;
  c public.customers;
  shop jsonb;
  balance numeric;
  entries jsonb;
begin
  select * into k from public.khata_shares where token = p_token;
  if not found then
    return null;
  end if;
  select * into c from public.customers where id = k.customer_id and shop_id = k.shop_id and not deleted;
  if not found then
    return null;
  end if;
  select jsonb_build_object('name', coalesce(ss.data ->> 'shopName', ''), 'phone', coalesce(ss.data ->> 'shopPhone', ''))
    into shop from public.shop_settings ss where ss.shop_id = k.shop_id;
  select c.opening_balance + coalesce(sum(t.total - t.paid), 0) into balance
    from public.txns t where t.customer_id = c.id and t.shop_id = k.shop_id and not t.deleted;
  select coalesce(jsonb_agg(e order by e ->> 'date' desc, (e ->> 'no')::int desc), '[]'::jsonb) into entries
    from (
      select jsonb_build_object(
        'date', t.date, 'type', t.type, 'no', t.no, 'items', t.items,
        'total', t.total, 'paid', t.paid, 'note', t.note
      ) as e
      from public.txns t
      where t.customer_id = c.id and t.shop_id = k.shop_id and not t.deleted
      order by t.date desc, t.no desc
      limit 200
    ) rows;
  return jsonb_build_object(
    'shop', coalesce(shop, jsonb_build_object('name', '', 'phone', '')),
    'customer', jsonb_build_object('name', c.name),
    'opening', c.opening_balance,
    'balance', balance,
    'entries', entries,
    'as_of', now()
  );
end;
$$;

grant execute on function public.khata_view(text) to anon, authenticated;
revoke execute on function public.share_khata(uuid) from public, anon;
revoke execute on function public.stop_sharing(uuid) from public, anon;
grant execute on function public.share_khata(uuid) to authenticated;
grant execute on function public.stop_sharing(uuid) to authenticated;

-- the owner sets where the app is on the web, so the links point at it
drop function if exists public.admin_save_config(text, text, text, text, integer);

create or replace function public.admin_save_config(
  p_upi_id text, p_upi_name text, p_support_phone text, p_app_link text, p_free_scans integer, p_web_url text
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
        free_scans = greatest(0, coalesce(p_free_scans, 5)),
        web_url = rtrim(btrim(coalesce(p_web_url, '')), '/')
    where id;
end;
$$;

revoke execute on function public.admin_save_config(text, text, text, text, integer, text) from public, anon;
