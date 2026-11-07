-- Selo de autoridade (Superadmin / Admin da comunidade) nos comentários e respostas: hoje só
-- aparece no post (author_is_superadmin em statuses, ver 20260926000018_status_author_badge.sql).
-- Nunca confia no que o cliente manda; resolvido na MESMA query que já lista/pagina os
-- comentários (join/função, nunca 1 consulta por comentário).
--
-- Os dois selos são AO VIVO (papel/posse ATUAL), e não por acaso: ao contrário do post, que
-- sempre teve author_is_superadmin gravado no momento da publicação (desde
-- 20260926000018_status_author_badge.sql), um COMENTÁRIO nunca teve nenhum registro de papel
-- histórico antes desta migration. Não existe, em lugar nenhum do schema, um log de quando um
-- usuário ganhou/perdeu o papel de superadmin -- só o papel ATUAL (public.users.role). Gravar
-- author_is_superadmin em post_comments com uma coluna + trigger (como statuses faz) resolveria
-- bem os comentários NOVOS, mas deixaria todo o histórico já existente preso em `false` por
-- padrão -- ou, se fosse "corrigido" com um UPDATE em massa usando o papel atual dos autores,
-- fabricaria uma afirmação histórica que os dados não sustentam (um usuário promovido a
-- superadmin DEPOIS de comentar pareceria tê-lo sido desde sempre). As duas alternativas violam
-- a mesma regra: nunca confundir papel atual com papel histórico. Resolver ao vivo evita o
-- dilema por completo -- corrige TODO o histórico (sem migrar nenhuma linha) e nunca mantém um
-- selo depois de alguém perder o cargo, exatamente como já é obrigatório para o selo de
-- administrador da comunidade.
--
-- Esta escolha é deliberadamente diferente do selo do POST: lá a semântica histórica já existe
-- desde a primeira versão do produto e trocá-la agora seria uma regressão real (gente que via o
-- selo passaria a não ver, ou vice-versa); aqui o selo em comentários nunca existiu, então não há
-- nenhuma regressão possível ao escolher o desenho mais simples e mais correto.

create function private.is_user_superadmin(p_user_id uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.users where id = p_user_id and role = 'superadmin')
$$;
revoke all on function private.is_user_superadmin(uuid) from public, anon;
grant execute on function private.is_user_superadmin(uuid) to authenticated, service_role;

-- security_invoker=true (já era assim): o join novo com statuses/communities fica sujeito à
-- MESMA RLS que o viewer já teria para ler esses dois status/comunidade (statuses_select e
-- communities_select) -- quem já pode ler os comentários de um post também pode ler o status e a
-- comunidade dele, então o join nunca nega nem vaza nada que can_view_status já não garantisse.
-- is_user_superadmin() é security definer só para contornar a RLS de public.users (que só libera
-- a própria linha ou um viewer que já é superadmin) -- devolve apenas um booleano, nunca o papel
-- em si nem qualquer outro dado do autor.
create or replace view public.comment_list_items
with (security_invoker = true) as
select
  c.id,
  c.status_id,
  c.author_id,
  c.parent_comment_id,
  c.root_comment_id,
  c.ancestor_ids,
  c.depth,
  c.body,
  c.status,
  c.reply_count,
  c.like_count,
  c.score,
  c.created_at,
  c.updated_at,
  c.edited_at,
  p.username as author_username,
  p.avatar_path as author_avatar_path,
  private.is_user_superadmin(c.author_id) as author_is_superadmin,
  (cm.owner_id is not null and cm.owner_id = c.author_id) as author_is_community_admin
from public.post_comments c
left join public.public_profiles p on p.user_id = c.author_id
left join public.statuses s on s.id = c.status_id
left join public.communities cm on cm.id = s.community_id;

-- comment_context (tela "Conversa", deep link de notificação/comentário): a comunidade é a MESMA
-- para todo o fio (todo item do caminho pertence ao mesmo status), então o dono é resolvido 1 vez
-- (status_ctx), não por item do caminho.
create or replace function public.comment_context(p_comment_id uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with target as (
    select * from public.post_comments where id = p_comment_id
  ), status_ctx as (
    select st.community_id, cm.owner_id as community_owner_id
    from target t
    join public.statuses st on st.id = t.status_id
    left join public.communities cm on cm.id = st.community_id
  ), path_ids as (
    select item.item_id, item.ordinality
    from target t
    cross join lateral unnest(t.ancestor_ids || t.id)
      with ordinality as item(item_id, ordinality)
  ), path as (
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'statusId', c.status_id,
        'authorId', c.author_id,
        'authorUsername', p.username,
        'authorAvatarPath', p.avatar_path,
        'authorIsSuperAdmin', private.is_user_superadmin(c.author_id),
        'authorIsCommunityAdmin', coalesce(
          (select sc.community_owner_id is not null and sc.community_owner_id = c.author_id
           from status_ctx sc),
          false
        ),
        'parentCommentId', c.parent_comment_id,
        'rootCommentId', c.root_comment_id,
        'ancestorIds', c.ancestor_ids,
        'depth', c.depth,
        'body', c.body,
        'status', c.status,
        'replyCount', c.reply_count,
        'likeCount', c.like_count,
        'score', c.score,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at,
        'editedAt', c.edited_at
      ) order by i.ordinality
    ) as comments
    from path_ids i
    join public.post_comments c on c.id = i.item_id
    left join public.public_profiles p on p.user_id = c.author_id
  )
  select case when t.id is null then null else jsonb_build_object(
    'statusId', t.status_id,
    'communityId', s.community_id,
    'targetCommentId', t.id,
    'comments', coalesce(path.comments, '[]'::jsonb)
  ) end
  from (select 1) seed
  left join target t on true
  left join public.statuses s on s.id = t.status_id
  left join path on true
$$;

revoke execute on function public.comment_context(uuid) from public, anon;
grant execute on function public.comment_context(uuid) to authenticated;
