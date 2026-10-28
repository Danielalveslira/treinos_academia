# Fase 6.1 — consolidação técnica e preparação de lançamento

28/10/2026. Base confirmada: `finance-advertising-phase6`, `5571e5c15e6489ec3c06fd6cda2d207e69d3e75e`. Trabalho no worktree existente `.finance-local/phase6`, inicialmente limpo. Conectividade Git conferida; branch/alterações do workspace principal preservadas.

**Resultado:** correções implementadas e validação integrada local para revisão técnica. Lançamento comercial continua bloqueado pelas decisões B e dependências C do checklist. Não houve push, merge, deploy, alteração de produção, cobrança real, tarifa oficial, habilitação real de métricas ou Fase 7.

## Arquitetura e correções

A [matriz de responsabilidades](ARQUITETURA_FINAL.md) cobre carteira, ledger, EvoCoins, precificação, InfinitePay, reversões, motor, direitos, vitrines, profissionais/locais, campanhas, inventário, impulsos, métricas, editorial, mídia, Auth e cache/Realtime. A análise combinou planejamento mestre, inventários/entregas 0–6, correções 4.1/5.1, código e catálogo local. Não se inferiu estado de produção a partir dos relatórios.

Correções efetivas:

1. Resposta antiga dos destaques não pode mais modificar estado antes da verificação de geração/prazo. Adotado commit diferido nas duas páginas, com teste de resposta obsoleta e desmontagem.
2. Queda do Realtime permite até três consultas backend com leases de até cinco segundos, sem prolongar vencimento contratual. Falha/esgotamento fecha a superfície; reconexão recupera decisão nova. Sem polling ilimitado ou consulta financeira por render.
3. Eventos operacionais sem identificação pessoal, buffer de 100 entradas e teste real de interrupção/retomada do serviço local; não viram audiência, reembolso ou SLA.
4. Removidos consulta redundante de destaque e dois wrappers frontend de compra por pacote sem consumidores. Mecanismos/históricos financeiros legítimos preservados.
5. Drift real de duas constraints, um default e um grant corrigido por migration aditiva; nenhuma das 203 migrations anteriores reescrita. Manifesto/gate protege histórico e versões. O registro local foi reconciliado sob prova de paridade, sem reaplicar migrations.
6. CI financeiro usa o container do próprio job. Harnesses financeiros/concorrentes respeitam aceite sintético vigente, nomes únicos e capacidade já comprometida; nenhum gate foi enfraquecido.
7. Wrapper de homologação usa alias HTTPS interceptado pelo mock local, corrigindo o checkout de demonstração sem modificar produção/integração InfinitePay.
8. Portal de publicidade identifica expressamente preços/campanhas/métricas sintéticos no preview DEV.

Detalhes em [segurança](AUDITORIA_SEGURANCA.md), [migrations e implantação](MIGRATIONS.md), [performance](PERFORMANCE.md) e [arquivos/remoções](ARQUIVOS.md).

## Evidências atuais

| Verificação executada | Resultado e localização |
| --- | --- |
| JavaScript completo | 2.260 testes, zero falhas/skips; `evidence/javascript-final.log` |
| Hooks/acesso afetados, rodada final | 16 testes aprovados; `affected-final.log` |
| Edge Functions | 203 aprovados, zero falhas, três skips opt-in; `edge.log` |
| pgTAP | 17 suítes, 1.000 asserções; reexecutadas após o guard; `sql-final.log` e `sql-summary.json` |
| Concorrência PostgreSQL | Carteira/preços/renovação, última vaga/global/replay/suspensão, edição/aprovação/mídia, múltiplos cadastros e teto EvoCoins; logs `*-concurrency.log` e `concurrency.log` |
| HTTP financeiro real local | Oito cenários, inclusive 12 webhooks concorrentes/crédito único, sessão revogada, timeout/divergência e pagamento tardio; `http.log` |
| Browser comercial | Criar/submeter/aprovar/cotar/contratar; seis larguras/temas da central; `browser.log`/`browser.json` |
| Lifecycle publicitário | Comunidade/global/impulsos, renovação, upload/gateway reais locais, mídia pendente/suspensa/expirada negada e eventos sintéticos deduplicados; `lifecycle.json` |
| Realtime real local | Suspensão/retomada sem reload, interrupção real do serviço, backend limitado, esgotamento e reconexão; `live-browser.json`; suspensão observada 250 ms nesta execução, sem promessa de SLA |
| Responsividade | 78 verificações: 13 rotas × 320/390/1440 × claro/escuro, zero overflow, exceções ou respostas HTTP de erro; `visual.json`. Aviso DEV verificado adicionalmente nas seis combinações afetadas; `visual-metrics.json` |
| Público/SEO | 18 regressões aprovadas, incluindo expiração durante IO e sitemap; `seo.log` |
| Integridade read-only | Todas as contagens financeiras em zero, permissões proibidas falsas e coleta desligada; `integrity-final.log`/`readonly-audit.json` |
| Instalação/paridade | 203 migrations desde aplicação vazia + guard aditivo (204); zero diferenças finais em 475 funções/132 tabelas/nove views; `clean-install.json`, `clean-upgrade.log`, `schema-comparison.json` |
| Upgrade/rollback de teste | Hashes de carteiras, ledger, pedidos, direitos, preços e anúncios legados inalterados; `migrations-reinstall-final.log` e log SQL completo copiado |
| Registro local | 19 versões ausentes registradas somente após prova de paridade; 204 presentes ao final, sem replay SQL; `registry-repair.json` |
| Integridade de migrations | 204 arquivos, 203 históricos com hash intacto; testes de remoção/adulteração/duplicação/retrodatação; `migration-integrity*.log` |
| Gates de release | 92 testes aprovados; `release-tests-final.log` |
| Lint/build/budget/scanners | Build/budget aprovados; lint sem erros e 14 warnings herdados; scanner fonte/build sem findings; logs finais em evidence |
| Rotação | 500 seleções por superfície, sete campanhas na Home e uma em cada posição da comunidade; sem gravação de audiência; `rotation.json` |
| Performance | EXPLAIN ANALYZE/BUFFERS e 20 amostras publicitárias; valores e limites em PERFORMANCE.md |

As capturas foram também inspecionadas visualmente em carteira mobile e portal publicitário escuro; não foi necessário redesenhar páginas. Primer, dark mode e lazy loading preservados. A revisão adicional identificou a necessidade de rotular as métricas sintéticas, corrigida no portal.

## Skips, falhas investigadas e limites

Os três skips Edge são notificações/push opt-in que exigem PG_TEST_CONTAINER e não fazem parte das mudanças publicitárias; os testes financeiros e concorrências foram executados separadamente no PostgreSQL real local. Não se desligou teste/proteção.

A primeira suíte JS dentro do sandbox não executou corretamente subprocessos de testes de fuso; a rodada completa fora da restrição passou. Os testes de release também precisaram de subprocessos. Instalação vazia exigiu DDL de serviço completo e espera TCP definitiva do Postgres. Browser inicialmente reutilizava conta/título; seed tentava reduzir capacidade comprometida. Concorrências antigas não preparavam o aceite da política local vigente. Essas precondições foram corrigidas, preservando as asserções. O preview herdado encerrou; foi reiniciado antes da entrega.

Não foram executados CI remoto, homologação InfinitePay real, restauração de produção, benchmark de infraestrutura hospedada, carga remota, Lighthouse/CLS ou testes em aparelho físico. Não se afirma novo p50/p95 de cada fluxo não alterado. A prova limpa cobre schema da aplicação sobre DDL Auth/Storage, não a instalação interna de serviços hospedados. O drift do registro local foi reparado apenas após nova prova de paridade e integridade, registrando as 19 versões ausentes sem reaplicar SQL; evidências antes/depois preservadas. Monitoramento operacional de navegador é temporário, não durável.

Não permaneceu falha crítica conhecida de integridade financeira/autorização/exposição privada nos cenários locais executados. Isso não certifica o banco/infraestrutura de destino. Pendências comerciais/externas e autorização de implantação são bloqueantes, não tarefas marcadas como simuladas/concluídas.

## Preview consolidado

Servidor local na porta 5173: <http://127.0.0.1:5173>. Encaminhamento configurado no Codespace: <https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev>. É desenvolvimento local dependente desta sessão/containers, não deployment persistente. Nenhum teste de acesso externo ao endereço encaminhado foi usado para afirmar disponibilidade pública.

Rotas: `/evocash`, `/admin/compras-evocash`, `/admin/parcerias?tab=engine`, `/admin/parcerias?tab=autonomous`, `/vitrine`, `/vitrine/gerenciar`, `/profissionais`, `/locais`, `/minha-vitrine`, `/meus-anuncios`, `/app` e comunidades. Todas usam o mesmo backend local.

Acesso sintético atual:

| Papel | Login | Senha exclusivamente local |
| --- | --- | --- |
| Administrador | `admin.financeiro@example.invalid` | `Evolutus-Local-Fase1!2026` |
| Publicidade/carteira | `publicidade-19961268-c97a-432f-bcaa-91b630c96c20@example.invalid` | `Evolutus-Local-Fase6!2026` |
| Audiência | `audience-2248a33c-e967-408e-8720-216a831829cd@example.invalid` | `Evolutus-Local-Fase6!2026` |
| Catálogos/perfis das fases anteriores | `vitrine-f0ce662d-23d6-4d52-a930-b6d4b380678e@example.invalid` | `Evolutus-Local-Fase4!2026` |

Comunidade desta execução: `/comunidades/935e1287-78f8-4793-bbaf-6fa939fbda78`. Conta publicitária: `/meus-anuncios?accountId=4559fadc-bee8-469f-9a40-54c5b3a2a573`. Fixtures novas mudam os IDs/e-mails; os valores atuais e sessões ficam nos arquivos ignorados `.finance-local/*access.json`. Nenhum token de sessão é documento versionado.

As tarifas e campanhas existentes nesse backend são fixtures; operações financeiras reais continuam desativadas/inexistentes. A instalação limpa nasce sem preços/vendas/capacidade/veiculação/coleta; ativar esses gates no destino não integra esta entrega.

## Reprodução principal

Somente neste ambiente descartável e com dependências/serviços locais disponíveis:

```sh
node scripts/check-migration-integrity.mjs
node --test scripts/check-migration-integrity.test.mjs
node scripts/homolog/finance/consolidation-audit.mjs
node scripts/homolog/finance/phase6-validate.mjs
node scripts/homolog/finance/phase6-reinstall.mjs
node scripts/homolog/finance/consolidation-clean.mjs
node scripts/homolog/finance/consolidation-schema.mjs
PG_TEST_CONTAINER=evolutus_price_phase1_db node scripts/advertising-concurrency.mjs
FINANCE_HTTP_URL=http://127.0.0.1:55554 node scripts/homolog/finance/http-integration.mjs
npm test
npm run test:functions
npm run lint
npm run build
npm run budget
node scripts/release/scan-secrets.mjs --dist
```

Para recriar browser/lifecycle: seed → browser → lifecycle → live-browser → visual. Os harnesses precisam do preview iniciado (`npm run dev -- --config .finance-local/preview.config.mjs`). Seed e simulação só podem ser usados na base allowlisted; nunca no destino persistente. As consultas read-only são a opção adequada para inventário financeiro, não fixtures.

Próxima decisão é a revisão técnica desta entrega e das pendências do [checklist definitivo](CHECKLIST_LANCAMENTO.md). Instalação futura, rollback compatível e conciliação estão em MIGRATIONS.md; nenhuma ação de produção foi autorizada ou executada.
