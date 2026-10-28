# GitHub e CI

## Base de integração

Repositório `Danielalveslira/treinos_academia`, destino `main`, branch `finance-advertising-phase6`. HEAD inicial 5571e5c; onze commits acumulam Fases 0–6 sobre main 5b50b26. Consolidação posterior estava sem commit e será registrada sem rebase/reset ou alteração dos worktrees legítimos externos.

204 migrations locais, 28 adicionais à main e 203 preservadas por hash relativamente à Fase 6. O PR inclui a cadeia inteira de dependências. Nenhum arquivo privado de `.finance-local`, `.env`, node_modules/dist/cache ou captura raster de QA é publicado; as evidências versionadas são textos/metadados de homologação.

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
