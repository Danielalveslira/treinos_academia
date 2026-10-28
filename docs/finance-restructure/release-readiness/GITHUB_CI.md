# GitHub e CI

## Base de integração

Repositório `Danielalveslira/treinos_academia`, destino `main`, branch `finance-advertising-phase6`. HEAD inicial 5571e5c; onze commits acumulam Fases 0–6 sobre main 5b50b26. Consolidação posterior estava sem commit e será registrada sem rebase/reset ou alteração dos worktrees legítimos externos.

205 migrations locais, 29 adicionais à main e 203 preservadas por hash relativamente à Fase 6. O PR inclui a cadeia inteira de dependências. Nenhum arquivo privado de `.finance-local`, `.env`, node_modules/dist/cache ou captura raster de QA é publicado; as evidências versionadas são textos/metadados de homologação.

## Gates

Workflow `Supabase & app tests`: JS/lint/build/budget/scanners/browser, SQL/pgTAP/Edge/concorrência, integração financeira E2E e gate agregado `finance-quality`. A consolidação acrescenta integridade de migrations e corrige o container da concorrência no finance-e2e. Evidência local não substitui execução remota.

## Proteção

Consulta administrativa confirmou `finance-quality` obrigatório, strict=true (atualização com main), administradores sujeitos à regra, force push/delete negados; não havia rulesets adicionais. Inicialmente o número obrigatório de aprovações era zero. Evidências antes/depois estão em `evidence/main-protection-*.json`; o reforço autorizado foi aplicado: uma aprovação obrigatória e aprovação do último push, sem afrouxar as demais proteções.

PR, commits publicados e resultados de checks serão atualizados após execução. Auto-merge deve permanecer desativado. Nenhum merge ou deploy é permitido por esta etapa.

## Primeiro CI remoto — falhas reais investigadas

PR [#87](https://github.com/Danielalveslira/treinos_academia/pull/87), commit 950988f. Run [40751421633](https://github.com/Danielalveslira/treinos_academia/actions/runs/40751421633) terminou com falha; secrets passou e o E2E de atividade/recompensa passou antes da concorrência. Não foi declarado verde.

- Smoke público tinha contagem antiga de sete links; o contrato agora inclui os oito destinos exatos e exercita /locais. A matriz ampliada encontrou CSS ausente no HTML fallback da nova página em 320 px; o template passou a carregar a folha existente e o handler evita duplicá-la.
- Das 88 suítes/3.790 asserções SQL, uma esperava SESSION_REVOKED em record_promotion_event e recebeu APP_ACCESS_DENIED. Migration aditiva 20261206000002 restaura o guard explícito antes da validação de contexto, sem alterar saldo, métricas ou autorização.
- Concorrência no finance-e2e recusava o próprio container evolutus_integrated_db. Allowlist corrigida para esse container descartável, preservando verificação da imagem e rejeição de bancos remotos.
- A stack antiga local não reiniciou por erro Docker RWLayer unexpectedly nil. Os containers foram preservados; criada uma base nova de homologação com prefixo release allowlisted, mantendo a stack padrão do CI. Espera de inicialização limitada ampliada para até 60 s, sem retry de operação financeira.

Correções em validação local; a atualização seguinte do PR executará novamente todos os gates remotos. Auto-merge confirmado null, main protegida e revisão humana pendente.

Validação local após as correções: 205 migrations instaladas na base nova, 88 suítes/3.790 asserções SQL aprovadas, concorrência publicitária real aprovada e 11 regressões de handlers públicos/SEO aprovadas. O smoke ampliado permanece em execução local (320/360/375/390 já aprovados nos temas claro/escuro); sua matriz completa também permanece obrigatória no CI.

## Segunda rodada e correções adicionais

Run [40753714834](https://github.com/Danielalveslira/treinos_academia/actions/runs/40753714834), commit ab6761e: SQL completo passou; frontend avançou pelos cabeçalhos, fichas, entradas e Home, mas o harness de métricas ainda não declarava import.meta.env nem isolava a importação Supabase da nova central. Ajustado o ambiente de build e usado backend estrito que falha em qualquer RPC comercial inesperada; as asserções de métricas/administração foram preservadas e passaram localmente.

O finance-e2e passou novamente pelo fluxo real de atividade, mas o guard comparava digest do índice OCI com ID de configuração Docker. O runner usou config f557… para o índice aprovado b3bf…; agora a verificação por ID consulta RepoDigests e mantém o pin, a plataforma e a correspondência com a imagem efetiva. O CLI mantém suporte aos nomes oficiais versionados (nesta execução, PostgreSQL 17.11). Helper compartilhado elimina a mesma comparação incorreta em dois harnesses. Testes negativos rejeitam índice errado, config divergente e nomes não oficiais. Nenhum pin foi alterado nem aceito SHA arbitrário.

Validação local adicional: 23 testes de imagens, concorrência real e todos os smokes restantes (fichas, entradas, Home, métricas/admin, catálogo e offline) aprovados. Cabeçalhos: 272 verificações em oito larguras/temas. Evidências nesta pasta. A terceira rodada remota continua obrigatória antes de declarar a Etapa 1 aprovada.

## Terceira rodada aprovada

Commit bf8b556: [run 40755850175](https://github.com/Danielalveslira/treinos_academia/actions/runs/40755850175), js/sql/finance-e2e/secrets/finance-quality COMPLETED SUCCESS. Reconferido após retomada: PR OPEN, REVIEW_REQUIRED, autoMergeRequest=null. Supabase Preview SKIPPED (serviço externo, não gate obrigatório); Vercel Preview automático SUCCESS. Nenhum merge realizado. A main continua sujeita à revisão humana; não foi concedida aprovação pelo agente.

A matriz pública local terminou com 272 verificações aprovadas. Novos documentos/probe/manifesto desta entrega serão commitados e o CI do novo HEAD será acompanhado; o verde anterior não substitui o gate desse HEAD.
