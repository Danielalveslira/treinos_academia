-- Direitos que subsistem sem o aceite da versão vigente dos termos gerais.
--
-- Até aqui as RPCs de reembolso usavam private.require_commercial_user(), que passa por
-- has_app_access() e portanto exige o aceite da versão jurídica vigente. Resultado: um
-- titular com termos desatualizados (ou com conta suspensa) não conseguia consultar a
-- política, os comprovantes, pedir reembolso de uma compra anterior nem acompanhar ou
-- contestar o protocolo -- direitos que não dependem de aceitar um texto novo.
--
-- Esta migration troca SOMENTE essa chamada, nas oito RPCs de reembolso listadas abaixo,
-- por private.require_rights_user(): sessão autenticada ainda válida e conta ativa
-- (suspensão e termos desatualizados não impedem; conta desativada ou em exclusão sim). Nenhuma outra linha das funções muda (a substituição é
-- textual e verificada: o número de chamadas por função precisa ser exatamente o esperado
-- -- create_refund_request e act_on_refund_request repetem a checagem depois dos locks --
-- e a migration aborta se o corpo vigente divergir). Ações administrativas continuam exigindo
-- private.require_evocash_admin(true) dentro das próprias funções. Compras e
-- contratações novas continuam exigindo require_commercial_user (aceite vigente).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.require_rights_user() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'APP_ACCESS_DENIED' using errcode = '42501'; end if;
  -- Mesmo código de erro de require_commercial_user para sessão revogada (contrato existente).
  if not private.current_session_active() then raise exception 'APP_ACCESS_DENIED' using errcode = '42501'; end if;
  -- Conta desativada pela administração ou em exclusão continua fora (contrato existente);
  -- restrição de comunidade/suspensão e termos desatualizados não removem estes direitos.
  if not exists (select 1 from public.users where id = auth.uid() and account_status = 'active') then
    raise exception 'APP_ACCESS_DENIED' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_rights_user() from public, anon, authenticated, service_role;

do $migration$
declare
  v_item record;
  v_def text;
  v_new text;
  v_count int;
begin
  for v_item in select * from (values
    ('public.get_refund_policy()'::regprocedure, 1),
    ('public.get_refund_source(text,uuid)'::regprocedure, 1),
    ('public.create_refund_request(text,uuid,text,text,uuid)'::regprocedure, 2),
    ('public.list_refund_requests(boolean,bigint,integer)'::regprocedure, 1),
    ('public.get_refund_request(uuid)'::regprocedure, 1),
    ('public.act_on_refund_request(uuid,text,text,uuid,bigint,jsonb)'::regprocedure, 2),
    ('public.get_refund_balance()'::regprocedure, 1),
    ('public.list_refund_events(uuid,bigint,integer)'::regprocedure, 1)
  ) as t(fn, expected) loop
    v_def := pg_catalog.pg_get_functiondef(v_item.fn);
    v_count := (char_length(v_def) - char_length(replace(v_def, 'private.require_commercial_user()', '')))
               / char_length('private.require_commercial_user()');
    if v_count <> v_item.expected then
      raise exception 'UNEXPECTED_REFUND_FUNCTION_BODY: % has % guard calls', v_item.fn, v_count;
    end if;
    v_new := replace(v_def, 'private.require_commercial_user()', 'private.require_rights_user()');
    execute v_new;
  end loop;
end $migration$;
