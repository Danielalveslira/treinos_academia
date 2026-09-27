-- Achado durante o teste da Fase 4: community_creation_requests.community_id
-- referenciava communities(id) sem on delete cascade -- excluir qualquer comunidade
-- criada via create_community_with_cash falhava com violação de FK (a linha de
-- rastreio de idempotência nunca é apagada sozinha). Não há como excluir a comunidade e
-- manter a linha (community_id é not null); cascade é o comportamento correto -- a linha
-- só existe para dedupe de uma tentativa de criação, sem valor histórico próprio depois
-- que a comunidade em si deixou de existir.
alter table public.community_creation_requests
  drop constraint community_creation_requests_community_id_fkey,
  add constraint community_creation_requests_community_id_fkey
    foreign key (community_id) references public.communities(id) on delete cascade;
