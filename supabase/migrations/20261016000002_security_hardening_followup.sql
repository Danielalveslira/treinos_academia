-- Fecha dois achados da auditoria de segurança (Fase 3.1). Correção mínima: nenhum corpo de função muda,
-- nenhum comportamento para usuários legítimos muda.
--
-- 1) mark_infinitepay_checkout_uncertain(uuid): SECURITY DEFINER que congela o checkout de uma compra
--    (checkout_uncertain = true, lease zerado). Só a Edge Function infinitepay-create-checkout a chama,
--    com service_role. A migration 20261015000001 já fazia o REVOKE, mas um ambiente em que a função
--    ficou com o EXECUTE padrão de PUBLIC (anon e authenticated incluídos) permitia a qualquer pessoa
--    que conhecesse o UUID de uma compra congelar o checkout dela. Reafirma o fechamento (idempotente:
--    é o mesmo padrão de "reafirma" da migration 20261014000005).
revoke all on function public.mark_infinitepay_checkout_uncertain(uuid) from public, anon, authenticated;
grant execute on function public.mark_infinitepay_checkout_uncertain(uuid) to service_role;

-- 2) review_blocked_account_deletion(uuid, text): foi redefinida (20261015000004) com
--    `search_path = public`, depois da migration de endurecimento -- sem pg_temp, o schema temporário seria
--    consultado PRIMEIRO para relações não qualificadas dentro de uma função SECURITY DEFINER. Todas as
--    referências do corpo já são qualificadas (public.*, auth.uid()) e o pg_catalog é sempre implícito, então
--    o search_path vazio é compatível (mesmo padrão de complete_workout_session). ALTER FUNCTION muda só a
--    configuração: grants e corpo ficam intactos.
alter function public.review_blocked_account_deletion(uuid, text) set search_path = '';
