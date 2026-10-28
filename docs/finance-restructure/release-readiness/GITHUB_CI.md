# GitHub e CI

## Base de integração

Repositório `Danielalveslira/treinos_academia`, destino `main`, branch `finance-advertising-phase6`. HEAD inicial 5571e5c; onze commits acumulam Fases 0–6 sobre main 5b50b26. Consolidação posterior estava sem commit e será registrada sem rebase/reset ou alteração dos worktrees legítimos externos.

204 migrations locais, 28 adicionais à main e 203 preservadas por hash relativamente à Fase 6. O PR inclui a cadeia inteira de dependências. Nenhum arquivo privado de `.finance-local`, `.env`, node_modules/dist/cache ou captura raster de QA é publicado; as evidências versionadas são textos/metadados de homologação.

## Gates

Workflow `Supabase & app tests`: JS/lint/build/budget/scanners/browser, SQL/pgTAP/Edge/concorrência, integração financeira E2E e gate agregado `finance-quality`. A consolidação acrescenta integridade de migrations e corrige o container da concorrência no finance-e2e. Evidência local não substitui execução remota.

## Proteção

Consulta administrativa confirmou `finance-quality` obrigatório, strict=true (atualização com main), administradores sujeitos à regra, force push/delete negados; não havia rulesets adicionais. Inicialmente o número obrigatório de aprovações era zero. Evidências antes/depois estão em `evidence/main-protection-*.json`; reforço de aprovação humana está sendo aplicado conforme autorização do planejamento.

PR, commits publicados e resultados de checks serão atualizados após execução. Auto-merge deve permanecer desativado. Nenhum merge ou deploy é permitido por esta etapa.
