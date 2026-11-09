-- Acrescenta p_post_access a create_community (hoje hardcoded 'everyone' no INSERT) e cria
-- set_community_post_access para alterar depois da criação -- lacuna confirmada: o campo era
-- mutável livremente por UPDATE direto do dono (RLS communities_update já permite), sem RPC
-- dedicada nem gate. can_post_in_community não precisa mudar: já implementa exatamente a
-- semântica correta (post_access='admins' -> dono OU superadmin podem postar -- confirmado que
-- não existe papel de "moderador" de comunidade distinto desses dois nesta base de código).
--
-- CREATE OR REPLACE FUNCTION só substitui uma função existente se a lista de tipos de
-- parâmetros for idêntica -- acrescentar um parâmetro criaria uma SEGUNDA função sobrecarregada
-- em paralelo à antiga, deixando chamadas com 6 argumentos ambíguas para o PostgREST. Por isso
-- o DROP explícito da assinatura antiga antes do CREATE da nova (mesma transação): garante que
-- só existe uma assinatura em qualquer momento. O frontend atualmente publicado chama
-- supabase.rpc('create_community', {...}) com 6 parâmetros NOMEADOS -- continua funcionando
-- sem nenhuma mudança, usando o default 'everyone' do 7º parâmetro.
drop function if exists public.create_community(text, text, text, text, text, text);

create function public.create_community(
  p_name text, p_description text, p_icon_name text, p_tier text, p_payment_method text,
  p_idempotency_key text, p_post_access text default 'everyone'
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_post_access text := coalesce(p_post_access, 'everyone');
  v_hash text;
  v_existing public.community_creation_requests;
  v_product public.community_creation_products;
  v_state jsonb;
  v_blocker text;
  v_asset text;
  v_price integer;
  v_balance numeric;
  v_community_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if p_payment_method is null or p_payment_method not in ('evocoins', 'evocash') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;
  if v_post_access not in ('everyone', 'admins') then raise exception 'INVALID_POST_ACCESS'; end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'INVALID_NAME'; end if;
  if char_length(v_description) > 300 then raise exception 'INVALID_DESCRIPTION'; end if;

  perform pg_advisory_xact_lock(hashtextextended('community_creation:' || v_uid::text, 0));

  -- Hash sobre uma serialização jsonb estruturada (chave->valor), não concat_ws com
  -- delimitador: concatenar texto com '|' é ambíguo quando um campo contém '|' (ex.: nome
  -- "a|b" + descrição "c" colide com nome "a" + descrição "b|c"). jsonb_build_object escapa
  -- cada valor como string JSON própria e seu ::text é determinístico para as mesmas
  -- chaves/valores. post_access agora faz parte da identidade lógica da solicitação: a mesma
  -- chave com post_access diferente é payload diferente, nunca um replay incorreto.
  v_hash := md5(jsonb_build_object(
    'name', v_name, 'description', v_description, 'iconName', p_icon_name,
    'tier', p_tier, 'paymentMethod', p_payment_method, 'postAccess', v_post_access
  )::text);
  select * into v_existing from public.community_creation_requests
    where user_id = v_uid and request_id = p_idempotency_key;
  if found then
    if v_existing.kind <> 'create' or v_existing.input_hash <> v_hash then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'id', v_existing.community_id, 'replay', true, 'tier', v_existing.tier,
      'paymentAsset', v_existing.payment_asset, 'amountCharged', v_existing.amount_charged
    );
  end if;

  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  -- 1) Elegibilidade (recalculada aqui, nunca confiada).
  v_state := private.community_creation_state(v_uid);
  v_blocker := private.community_creation_blocker(v_state);
  if v_blocker is not null then raise exception '%', v_blocker; end if;

  -- 2) Preço, só do servidor.
  select * into v_product from public.community_creation_products where tier = p_tier and active;
  if not found then raise exception 'INVALID_TIER'; end if;
  v_asset := case p_payment_method when 'evocoins' then 'coin' else 'cash' end;
  v_price := case p_payment_method when 'evocoins' then v_product.evocoins_price else v_product.evocash_price end;
  if v_price is null then raise exception 'PAYMENT_METHOD_UNAVAILABLE'; end if;

  -- 3) Saldo (com lock da carteira) e débito.
  perform public._wallet_ensure_row(v_uid);
  select case v_asset when 'coin' then coin_balance else cash_balance end into v_balance
    from public.wallets where user_id = v_uid for update;
  if v_balance < v_price then
    raise exception '%', case v_asset when 'coin' then 'INSUFFICIENT_COINS' else 'INSUFFICIENT_CASH' end;
  end if;

  -- 4) Comunidade + filiação do dono + débito + ledger + registro de idempotência/auditoria.
  insert into public.communities (name, description, icon_name, is_active, post_access, created_by, owner_id, tier, post_retention_mode)
    values (v_name, v_description, p_icon_name, true, v_post_access, v_uid, v_uid, v_product.tier, v_product.post_retention_mode)
    returning id into v_community_id;
  insert into public.community_members (community_id, user_id) values (v_community_id, v_uid);

  if v_asset = 'coin' then
    perform public._wallet_debit_coins(v_uid, v_price);
  else
    perform public._wallet_debit_cash(v_uid, v_price);
  end if;
  perform public._ledger_record(v_uid, 'community-creation:' || v_community_id::text, v_asset, 'debit', v_price,
    'community_creation', 'community', v_community_id::text);

  insert into public.community_creation_requests
    (user_id, request_id, community_id, input_hash, kind, tier, payment_asset, amount_charged)
    values (v_uid, p_idempotency_key, v_community_id, v_hash, 'create', v_product.tier, v_asset, v_price);

  return jsonb_build_object(
    'id', v_community_id, 'replay', false, 'tier', v_product.tier,
    'paymentAsset', v_asset, 'amountCharged', v_price
  );
end;
$$;
revoke all on function public.create_community(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_community(text, text, text, text, text, text, text) to authenticated;

-- RPC para alterar post_access depois da criação (dono ou superadmin). Não é financeira --
-- sem idempotency_key/lock avançado -- mas leva o guard de sessão por cautela, consistente
-- com o padrão já adotado em toda função SECURITY DEFINER sensível a conta/sessão revogada.
create or replace function public.set_community_post_access(p_community_id uuid, p_post_access text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_community public.communities;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if p_post_access not in ('everyone', 'admins') then raise exception 'INVALID_POST_ACCESS'; end if;

  select * into v_community from public.communities where id = p_community_id for update;
  if not found then raise exception 'COMMUNITY_UNAVAILABLE'; end if;
  if not (public.is_superadmin() or v_community.owner_id = v_uid) then raise exception 'NOT_OWNER'; end if;

  update public.communities set post_access = p_post_access where id = p_community_id;
  return jsonb_build_object('id', p_community_id, 'postAccess', p_post_access);
end;
$$;
revoke all on function public.set_community_post_access(uuid, text) from public, anon;
grant execute on function public.set_community_post_access(uuid, text) to authenticated;
