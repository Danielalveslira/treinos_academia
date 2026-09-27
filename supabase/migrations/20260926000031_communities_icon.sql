-- main trocou upload de imagem por um conjunto fixo de ícones (COMMUNITY_ICON_NAMES);
-- image_url fica pra trás, sem uso, não removida por não ter certeza se algum dado
-- antigo ainda depende dela.
alter table public.communities add column if not exists icon_name text;
