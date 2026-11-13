-- PR3: a capacidade de CRIAR novos produtos legados (storefront_id is null) é
-- removida de verdade, não só escondida na interface. Nenhum consumidor moderno
-- depende deste caminho: vitrines modernas (storefront_id preenchido) sempre
-- escreveram por RPCs SECURITY DEFINER (save_storefront_product etc.), nunca por
-- insert direto do cliente -- a investigação que embasou esta decisão está
-- registrada no PR0 (busca completa por SELECT/INSERT/UPDATE/DELETE sobre
-- partner_products em src/, supabase/migrations/** e supabase/tests/**).
--
-- Edição, exclusão e associação de registros legados EXISTENTES continuam intactas
-- (partner_products_admin_update/delete, admin_associate_legacy_product) -- esta
-- migration remove apenas o caminho de criação de linhas novas com storefront_id
-- nulo. Não apaga nenhuma linha, não altera a tabela nem suas constraints.
set local lock_timeout='5s';

drop policy partner_products_admin_insert on public.partner_products;
revoke insert on public.partner_products from authenticated;
