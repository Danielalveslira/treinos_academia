-- Achado durante a auditoria da Vitrine: professional_listing_drafts.owner_id nunca
-- teve on delete cascade (só listing_id, via professional_listings, tinha), ao
-- contrário do que o comentário da migration do deletion worker (deletion_worker.sql)
-- assumia ("professional_listings->drafts... já é ON DELETE CASCADE"). Na prática,
-- excluir um usuário com um rascunho de Vitrine ainda não publicado falhava com
-- violação de FK -- run_deletion_job depende inteiramente de cascade pra limpar os
-- dados do usuário, sem nenhuma deleção explícita de professional_listing_drafts.
alter table public.professional_listing_drafts drop constraint professional_listing_drafts_owner_id_fkey;
alter table public.professional_listing_drafts add constraint professional_listing_drafts_owner_id_fkey
  foreign key (owner_id) references public.users(id) on delete cascade;
