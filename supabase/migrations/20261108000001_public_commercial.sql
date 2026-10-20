-- Commercial contacts are private; only the narrow RPC accepts anonymous submissions.
create table public.commercial_leads (
  id uuid primary key default gen_random_uuid(),
  company text not null check (char_length(company) between 2 and 120),
  contact text not null check (char_length(contact) between 2 and 120),
  email text not null check (char_length(email) between 5 and 254),
  whatsapp text check (whatsapp is null or char_length(whatsapp) <= 30),
  segment text not null check (char_length(segment) between 2 and 80),
  website text not null check (char_length(website) <= 500),
  modality text not null check (modality in ('Publicidade', 'Vitrine de produtos', 'Ambos')),
  message text not null check (char_length(message) between 20 and 2000),
  status text not null default 'novo' check (status in ('novo', 'em_contato', 'encerrado')),
  created_at timestamptz not null default now()
);
create index commercial_leads_created_idx on public.commercial_leads (created_at desc);
create index commercial_leads_rate_idx on public.commercial_leads (lower(email), created_at desc);
alter table public.commercial_leads enable row level security;
create policy commercial_leads_admin_read on public.commercial_leads for select to authenticated using (public.is_superadmin());
create policy commercial_leads_admin_update on public.commercial_leads for update to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
revoke all on public.commercial_leads from anon, authenticated;
grant select, update (status) on public.commercial_leads to authenticated;

create or replace function public.submit_commercial_lead(
  p_company text, p_contact text, p_email text, p_whatsapp text,
  p_segment text, p_website text, p_modality text, p_message text,
  p_privacy boolean, p_honeypot text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_website text := btrim(p_website);
begin
  if coalesce(p_honeypot, '') <> '' then raise exception 'invalid submission' using errcode = '22023'; end if;
  if p_privacy is distinct from true
    or char_length(btrim(p_company)) not between 2 and 120
    or char_length(btrim(p_contact)) not between 2 and 120
    or char_length(v_email) not between 5 and 254
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(btrim(p_segment)) not between 2 and 80
    or char_length(btrim(p_message)) not between 20 and 2000
    or p_modality not in ('Publicidade', 'Vitrine de produtos', 'Ambos')
    or char_length(v_website) > 500
    or v_website !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$'
    or (p_whatsapp is not null and (char_length(p_whatsapp) > 30 or p_whatsapp !~ '^[+() 0-9-]+$'))
  then raise exception 'invalid submission' using errcode = '22023'; end if;
  -- Serialize the count and insert together, including submissions from different emails.
  -- No public SELECT policy or returned contact row.
  perform pg_catalog.pg_advisory_xact_lock(4629, 1);
  if (select count(*) from public.commercial_leads where lower(email) = v_email and created_at > now() - interval '1 day') >= 3
    or (select count(*) from public.commercial_leads where created_at > now() - interval '1 day') >= 500
  then raise exception 'rate limited' using errcode = 'P0001'; end if;
  insert into public.commercial_leads(company, contact, email, whatsapp, segment, website, modality, message)
  values (btrim(p_company), btrim(p_contact), v_email, nullif(btrim(p_whatsapp), ''), btrim(p_segment), v_website, p_modality, btrim(p_message));
end $$;
revoke all on function public.submit_commercial_lead(text,text,text,text,text,text,text,text,boolean,text) from public;
grant execute on function public.submit_commercial_lead(text,text,text,text,text,text,text,text,boolean,text) to anon, authenticated;

create table public.partner_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  brand text not null check (char_length(brand) between 2 and 120),
  description text not null check (char_length(description) between 10 and 500),
  category text not null check (char_length(category) between 2 and 80),
  image_url text check (image_url is null or image_url ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$'),
  store_url text not null check (store_url ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$'),
  sponsored boolean not null default false,
  approved boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.partner_products enable row level security;
create policy partner_products_public_read on public.partner_products for select to anon, authenticated
  using (approved and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) or public.is_superadmin());
create policy partner_products_admin_insert on public.partner_products for insert to authenticated with check (public.is_superadmin());
create policy partner_products_admin_update on public.partner_products for update to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy partner_products_admin_delete on public.partner_products for delete to authenticated using (public.is_superadmin());
revoke all on public.partner_products from anon, authenticated;
grant select on public.partner_products to anon;
grant select, insert, update, delete on public.partner_products to authenticated;
