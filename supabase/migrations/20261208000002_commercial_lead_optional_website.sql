-- A public commercial proposal may omit the website. Keep every other validation,
-- the anonymous honeypot/rate limit and the existing table policies unchanged.
create or replace function public.submit_commercial_lead(
  p_company text, p_contact text, p_email text, p_whatsapp text,
  p_segment text, p_website text, p_modality text, p_message text,
  p_privacy boolean, p_honeypot text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_website text := coalesce(btrim(p_website), '');
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
    or (v_website <> '' and v_website !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$')
    or (p_whatsapp is not null and (char_length(p_whatsapp) > 30 or p_whatsapp !~ '^[+() 0-9-]+$'))
  then raise exception 'invalid submission' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(4629, 1);
  if (select count(*) from public.commercial_leads where lower(email) = v_email and created_at > now() - interval '1 day') >= 3
    or (select count(*) from public.commercial_leads where created_at > now() - interval '1 day') >= 500
  then raise exception 'rate limited' using errcode = 'P0001'; end if;
  insert into public.commercial_leads(company, contact, email, whatsapp, segment, website, modality, message)
  values (btrim(p_company), btrim(p_contact), v_email, nullif(btrim(p_whatsapp), ''), btrim(p_segment), v_website, p_modality, btrim(p_message));
end $$;
