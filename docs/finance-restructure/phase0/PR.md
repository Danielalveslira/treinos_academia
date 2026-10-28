# Inventariar a base comercial e financeira antes de alterar preços e cobranças

O plano de reestruturação foi produzido sobre um ZIP e não comprovava o estado publicado. Esta Fase 0 registra a main e o schema real, preserva os trabalhos locais anteriores e define dependências, sequência de migração e rollback por ambiente.

Reutiliza três consultas financeiras read-only e o comparador de catálogo existentes. Adiciona somente diagnóstico comercial read-only, plano normativo e evidências sanitizadas. Não inclui migrations, UI, ativação de cobranças, merge ou deploy.

Validação: 176 migrations reconstruídas em Postgres descartável com scaffold sintético de Auth/Storage; versões coincidentes com produção; oito diferenças de funções/grants do catálogo documentadas; quatro diagnósticos remotos read-only concluídos; zero achados no scanner de segredos e diff sem erros de whitespace. Os checks obrigatórios da revisão base passaram; detalhes da proteção da main estão pendentes por HTTP 403.

Aceite de saída da Fase 0 pendente conforme §14/§19 do plano. Preços, política de legado e demais decisões do §17 continuam sem ativação. Este texto prepara um PR exclusivo da Fase 0; não foi feito push para evitar disparar publicação de preview sem decisão específica de deploy.
