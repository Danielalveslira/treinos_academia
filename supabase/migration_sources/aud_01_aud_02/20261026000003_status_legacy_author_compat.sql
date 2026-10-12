-- Compatibilidade de clientes antigos/PWA: estes dois campos são dicas descartadas.
-- O trigger statuses_initialize_identity sobrescreve ambos com public.users.
-- Não restaurar INSERT de tabela nem UPDATE; promoção/contadores continuam proibidos.
begin;
grant insert (author_username, author_is_superadmin) on public.statuses to authenticated;
commit;
