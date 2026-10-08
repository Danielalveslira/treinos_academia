-- Texto das publicações de comunidade: limite sobe de 500 para 7000 caracteres.
--
-- Mantém o resto da regra (mínimo de 1 caractere; o formato por tipo continua em statuses_content_shape).
-- Comentários e demais campos NÃO mudam. Linhas existentes (<= 500) já satisfazem o novo limite, então a
-- validação da constraint é imediata e não bloqueia a tabela por muito tempo.
--
-- ORDEM DE PUBLICAÇÃO: aplique esta migration ANTES de publicar o frontend com o limite de 7000 (o editor
-- passa a aceitar até 7000; sem a migration, publicar entre 501 e 7000 caracteres falharia no banco).

alter table public.statuses drop constraint if exists statuses_text_check;
alter table public.statuses
  add constraint statuses_text_check check (char_length(text) between 1 and 7000);
