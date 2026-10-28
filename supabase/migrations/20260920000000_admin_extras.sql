-- The owner can now change the plan prices and the app's link from the অ্যাডমিন page. The link
-- goes on every free shop's ফর্দ and WhatsApp message, so their customers find the app too.

alter table public.app_config add column if not exists app_link text not null default '';

-- replaced by the version below, which also takes the app's link
drop function if exists public.admin_save_config(text, text, text);

create or replace function public.admin_save_config(p_upi_id text, p_upi_name text, p_support_phone text, p_app_link text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.app_config
    set upi_id = btrim(coalesce(p_upi_id, '')),
        upi_name = btrim(coalesce(p_upi_name, '')),
        support_phone = regexp_replace(coalesce(p_support_phone, ''), '\D', '', 'g'),
        app_link = btrim(coalesce(p_app_link, ''))
    where id;
end;
$$;

-- prices in rupees, and which plans the shops are offered
create or replace function public.admin_save_plans(p_plans jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
begin
  perform public.require_admin();
  for item in select * from jsonb_array_elements(coalesce(p_plans, '[]'::jsonb)) loop
    update public.plans
      set price = greatest(1, (item ->> 'price')::integer),
          active = coalesce((item ->> 'active')::boolean, active)
      where id = item ->> 'id';
  end loop;
end;
$$;

revoke execute on function public.admin_save_config(text, text, text, text) from public, anon;
revoke execute on function public.admin_save_plans(jsonb) from public, anon;
