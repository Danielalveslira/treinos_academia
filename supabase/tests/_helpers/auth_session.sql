-- Test fixtures only. Never a migration, RPC or production installation.
-- Uses real GoTrue auth.sessions instead of inventing a table or bypassing guards.
create or replace function pg_temp.set_test_user(p_uid text,p_local boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare v_session uuid;
begin
 perform set_config('request.jwt.claim.sub',coalesce(p_uid,''),p_local);
 if nullif(p_uid,'') is null then
  perform set_config('request.jwt.claims','{}',p_local);
 else
  v_session := md5('sql-fixture-session:'||p_uid)::uuid;
  if exists(select 1 from auth.users where id=p_uid::uuid) then
   insert into auth.sessions(id,user_id,created_at,updated_at)
    values(v_session,p_uid::uuid,now(),now()) on conflict(id) do nothing;
   -- Sessão de fixture representa, por padrão, um usuário normal e plenamente autorizado --
   -- a mesma suposição que todo teste existente já fazia antes de is_full_login_session()
   -- (20261223000003) exigir amr com password e onboarding concluído para has_app_access().
   -- Sem isto, toda RPC gateada por has_app_access() voltaria FORBIDDEN para esta fixture,
   -- quebrando testes anteriores que nunca tiveram a ver com o gate novo de sessão restrita.
   insert into private.auth_onboarding_completed(user_id,completed_at,source)
    values(p_uid::uuid,now(),'legacy') on conflict(user_id) do nothing;
   -- Aceite legal NÃO é preenchido aqui de propósito: ao contrário de amr/onboarding (conceitos
   -- novos que nenhum teste antigo podia ter previsto), o estado de aceite dos termos já era uma
   -- dimensão deliberadamente variada por vários testes (aud_has_app_access_gates_test 16c,
   -- supporters_failclosed_test, workout_participants_rpc_test -- alguns querem "aceitou", outros
   -- "não aceitou ainda" de propósito). Um default aqui sempre quebraria um dos dois grupos. Cada
   -- teste que precisa de aceite válido já grava isso explicitamente antes ou depois desta chamada.
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_uid,'role','authenticated','session_id',v_session,
    'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::int))
  )::text,p_local);
 end if;
 return coalesce(p_uid,'');
end;
$$;

-- Simula "sair de todos os dispositivos" (ou qualquer outra revogação) para a sessão de teste
-- criada por set_test_user(p_uid): remove a linha de auth.sessions, mas preserva os claims
-- (sub/role/session_id) já setados na transação -- private.current_session_active() passa a
-- negar porque a sessão não existe mais, exatamente como um JWT antigo de verdade se comportaria
-- depois de revogado em outro aparelho (20261113000001_session_revocation_guard.sql).
create or replace function pg_temp.revoke_test_session(p_uid text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 delete from auth.sessions where id = md5('sql-fixture-session:'||coalesce(p_uid,''))::uuid;
end;
$$;
