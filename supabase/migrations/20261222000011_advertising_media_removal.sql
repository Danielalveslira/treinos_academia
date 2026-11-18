set local lock_timeout='5s';
set local statement_timeout='30s';
-- Reestruturação do portal do anunciante (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md),
-- seção 5.2.2: "seleção, prévia, troca e remoção" de imagem. `p_media_id` sempre foi
-- "default null" e tratado como "sem alteração" (ver 20261205000007_advertising_media.sql:
-- `if p_media_id is not null then ... update ... media_id=p_media_id`), então nunca houve
-- como voltar a um anúncio sem imagem depois de anexar uma. Novo parâmetro `p_clear_media`,
-- explícito e mutuamente exclusivo com `p_media_id` (nunca os dois na mesma chamada), só
-- desvincula o rascunho da mídia -- a limpeza do arquivo em si continua por conta do job de
-- órfãos existente (storefront-media-cleanup), e o conteúdo público aprovado (sponsored_ads)
-- só muda quando essa edição for promovida por admin_review_advertising_campaign, como já
-- vale para título/descrição/destino.
alter function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer) set schema private;
alter function private.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer) rename to edit_advertising_campaign_before_media_clear;
revoke all on function private.edit_advertising_campaign_before_media_clear(uuid,bigint,text,text,text,boolean,uuid,integer) from public,anon,authenticated,service_role;

create function public.edit_advertising_campaign(p_id uuid,p_version bigint,p_title text,p_description text,p_destination text,p_submit boolean,p_media_id uuid default null,p_desired_days integer default null,p_clear_media boolean default false) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare result jsonb;
begin
 if p_clear_media and p_media_id is not null then raise exception 'AD_MEDIA_CONFLICT'; end if;
 result:=private.edit_advertising_campaign_before_media_clear(p_id,p_version,p_title,p_description,p_destination,p_submit,p_media_id,p_desired_days);
 if p_clear_media then
 update private.advertising_drafts set media_id=null where ad_id=p_id;
 result:=result||jsonb_build_object('media_id',null);
 end if;
 return result;
end $$;
revoke all on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer,boolean) from public,anon,service_role;
grant execute on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer,boolean) to authenticated;
