-- UX de acesso bloqueado: contrato estável para ENTRAR e estado de acesso da LISTAGEM, sem N+1.
-- Não altera nenhuma regra de banimento/remoção/desbanimento nem as policies já publicadas
-- (20261022000001): o INSERT direto em community_members segue negado ao banido (trigger de guarda
-- com COMMUNITY_BANNED + RLS). Estas RPCs só dão ao cliente estados identificáveis em vez de uma
-- exceção genérica, e o cliente nunca precisa interpretar texto de erro.

-- 1) Entrar na comunidade. Resultado (nunca exceção para estados de autorização):
--      joined | already_member | banned | unavailable
--    Sem sessão/termos/conta ativa => PERMISSION_DENIED (erro de autenticação, não de comunidade).
--    Mesmas regras da policy community_members_insert (has_app_access + comunidade ativa + sem restrição);
--    o trigger de guarda continua valendo e decide a corrida com um banimento concorrente.
create or replace function public.join_community(p_community_id uuid) returns text
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_active boolean;
begin
  if v_uid is null or not coalesce(public.has_app_access(), false) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select c.is_active into v_active from public.communities c where c.id = p_community_id;
  if v_active is null then
    return 'unavailable';
  end if;
  if exists (select 1 from public.community_restrictions r
             where r.community_id = p_community_id and r.user_id = v_uid) then
    return 'banned';
  end if;
  if not v_active then
    return 'unavailable';
  end if;
  if exists (select 1 from public.community_members m
             where m.community_id = p_community_id and m.user_id = v_uid) then
    return 'already_member';
  end if;

  begin
    insert into public.community_members (community_id, user_id) values (p_community_id, v_uid);
  exception
    when unique_violation then
      return 'already_member';
    when sqlstate '42501' then
      -- Banimento concorrente venceu a corrida (guarda do INSERT).
      if sqlerrm = 'COMMUNITY_BANNED' then return 'banned'; end if;
      raise;
  end;
  return 'joined';
end;
$$;
revoke execute on function public.join_community(uuid) from public, anon;
grant execute on function public.join_community(uuid) to authenticated;

-- 2) Estado de acesso do usuário logado a TODAS as comunidades onde ele é membro ou está banido, em UMA
-- consulta (a listagem "Explorar"/"Minhas" não faz uma chamada por cartão). Comunidades ausentes do
-- resultado são 'not_member'. SECURITY INVOKER: só lê as linhas do próprio usuário, as mesmas que o RLS já
-- libera (community_members_select e community_restrictions_select). Banido tem precedência.
create or replace function public.list_my_community_access()
  returns table (community_id uuid, access text)
  language sql stable security invoker set search_path = public, pg_temp as $$
    select r.community_id, 'banned'::text
    from public.community_restrictions r
    where r.user_id = (select auth.uid())
    union all
    select m.community_id, 'member'::text
    from public.community_members m
    where m.user_id = (select auth.uid())
      and not exists (select 1 from public.community_restrictions r
                      where r.community_id = m.community_id and r.user_id = m.user_id)
    limit 400
$$;
revoke execute on function public.list_my_community_access() from public, anon;
grant execute on function public.list_my_community_access() to authenticated;

-- 3) A consulta acima filtra restrições por user_id, que não é prefixo da PK (community_id, user_id).
-- Índice mínimo para ela (e para o cascade de exclusão de conta, que também filtra por user_id).
create index if not exists community_restrictions_user_idx on public.community_restrictions (user_id);

-- 4) Correção do lock de serialização "entrar x banir" (20261022000001): ele era uma trava advisory POR PAR
-- (comunidade, usuário), retida até o fim da transação. Um INSERT em lote grande numa única transação (carga,
-- importação, backfill) acumulava uma trava por linha e esgotava a memória compartilhada de locks
-- ("out of shared memory / max_locks_per_transaction"). Agora a trava cai em um de 512 baldes fixos: o mesmo par
-- sempre cai no mesmo balde (a serialização contra o banimento continua exata), pares diferentes que colidem
-- apenas esperam um ao outro por alguns milissegundos, e uma transação nunca segura mais de 512 travas.
-- Namespace próprio (primeiro int) para não colidir com outros usos de advisory lock.
create or replace function private.lock_membership(p_community_id uuid, p_user_id uuid) returns void
  language sql volatile set search_path = '' as $$
    select pg_advisory_xact_lock(
      hashtext('community_membership'),
      (hashtextextended(p_community_id::text || ':' || p_user_id::text, 0) & 511)::int
    )
$$;
revoke execute on function private.lock_membership(uuid, uuid) from public, anon, authenticated;
