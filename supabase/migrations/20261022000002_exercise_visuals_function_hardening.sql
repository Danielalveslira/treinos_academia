-- Endurecimento das funções do Exercise Visuals (V1/V2). SEM mudança funcional; independente da
-- migration de comunidades. Fecha dois achados dos testes de contrato de segurança
-- (security_followup_test, notification_security_test) que já valiam para o resto do banco desde
-- 20261014000005:
--
-- 1) 14 funções SECURITY DEFINER ficaram com `search_path=public` (sem `pg_temp`): o schema temporário
--    é consultado primeiro para tabelas não qualificadas (TEMP é concedido a anon/authenticated).
--    Mesmo critério e mesmo ajuste da migration 20261014000005: `public, pg_temp` não altera a
--    resolução de nenhum objeto real. Só toca em quem tem exatamente `search_path=public`.
-- 2) Duas funções de trigger SECURITY DEFINER do schema private herdaram EXECUTE de PUBLIC. Função de
--    trigger não precisa de EXECUTE do chamador para disparar; só da permissão de criar o trigger.
do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and p.prokind = 'f' and n.nspname in ('public', 'private')
      and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    v_count := v_count + 1;
  end loop;
  raise notice '[security] search_path com pg_temp em % funcoes', v_count;
end $$;

revoke execute on function private.exercise_visual_sets_guard() from public, anon, authenticated;
revoke execute on function private.exercise_visual_sets_audit() from public, anon, authenticated;
