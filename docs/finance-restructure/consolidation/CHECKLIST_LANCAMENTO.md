# Checklist definitivo — Fases 1 a 6 e consolidação

Estado: revisão técnica local; **lançamento comercial bloqueado**. Complementa o checklist histórico em `../CHECKLIST_LANCAMENTO.md`, sem transformar simulações em homologação de produção.

## A — Correções e validações técnicas locais

- [x] Base 5571e5c/branch e conectividade Git confirmadas; workspace principal preservado.
- [x] Matriz de autoridades financeiras/comerciais/editoriais confrontada com código e catálogo.
- [x] Sem carteira/ledger paralelo ou escrita financeira de navegador; dívida/reversão preservam mecanismo auditado.
- [x] Diagnóstico read-only reproduzível, fail-closed, sem correção manual de saldo.
- [x] Geração/commit impede resposta antiga de restaurar destaques; consulta redundante e funções frontend de pacotes sem consumidores removidas.
- [x] Queda real de Realtime local, revalidações backend limitadas, esgotamento fechado e reconexão testados.
- [x] Drift de constraints/default/grant corrigido aditivamente; nenhuma migration histórica modificada. Registro local reconciliado sob prova de paridade, sem replay SQL.
- [x] Instalação limpa da aplicação e upgrade transacional; equivalência final de schema/permissões e hashes financeiros preservados.
- [x] Capacidade, global indivisível, saldo compartilhado, replays e moderação concorrentes testados em PostgreSQL real.
- [x] EvoCoins concorrente mantém teto e ledger; legal gate preservado nas fixtures.
- [x] SQL, JavaScript, Edge, HTTP simulado, browser, responsividade, SEO, lint, build, budget e scanners executados com evidências.
- [x] Coleta publicitária desativada ao final; métricas de preview identificadas como sintéticas.
- [x] CI usa o container correto e verifica integridade histórica das migrations, sem mascarar falhas.
- [x] Plano de instalação/recuperação documentado, sem down migration destrutiva.

Avisos herdados de lint/chunk não foram ocultados. Testes opt-in de notificações/push e validações remotas não são marcados como executados. O diagnóstico operacional de navegador é temporário; uma política de monitoramento durável precisa ser validada no ambiente de destino. Ver limites concretos em ENTREGA e PERFORMANCE.

## B — Decisões comerciais e jurídicas pendentes

- [ ] Valor oficial BRL/EvoCash, mínimo/máximo de recarga, limites financeiros e antifraude.
- [ ] Preços dos serviços, duração mínima/máxima, vigências e confirmação dos termos de contratação.
- [ ] Capacidade por posicionamento/contexto, composição global, regras de distribuição sem audiência mínima prometida.
- [ ] Limites de recursos/produtos e contas empresariais/papéis; sem carteira empresarial ou gasto delegado implícito.
- [ ] Moderação, tratamento do legado, suspensão, revisão e retomada.
- [ ] Cancelamentos, arrependimento, estornos, reembolsos e compensação por indisponibilidade comprovada; sem automação presumida.
- [ ] Finalidade/base legal, consentimento quando aplicável, oposição, compartilhamento de relatório e retenção de métricas/auditoria/mídia.
- [ ] Compatibilidade jurídica/contratual do crédito pré-pago e das políticas com a InfinitePay.

Ausência dessas decisões mantém vendas reais bloqueadas. Seeds são exemplos de homologação, não tarifas aprovadas.

## C — Dependências externas e produção pendentes

- [ ] Homologação real InfinitePay: conta, credenciais, webhook, confirmação, atrasos, conciliação e cenários incertos.
- [ ] CI remoto obrigatório após push autorizado; branch protection e gates efetivos no GitHub.
- [ ] Registro atual de migrations e drift do destino, catálogo, permissões, dados/legado e referências de mídia.
- [ ] Backup e restauração de PostgreSQL e Storage comprovados no ambiente autorizado.
- [ ] Secrets, URLs/retornos, domínios, Vercel/rewrite/Edge e exclusão de wrappers/mocks dos artefatos de deploy.
- [ ] Realtime hospedado, publicação/permissões, reconexão, contenção do epoch e monitoramento de indisponibilidade.
- [ ] Storage/CDN: autenticação, cache, MIME, gateway e coleta com leases/referências no destino.
- [ ] Jobs operacionais com responsáveis: conciliação, lembretes, manutenção, retenção e alertas; expiração no servidor independente deles.
- [ ] Observabilidade durável e política de evidência/compensação, distinguindo falta de impressões de downtime.
- [ ] Testes de carga autorizados, cold start e dispositivos/redes móveis reais; sem extrapolar resultados locais.
- [ ] Smoke pós-instalação e reconciliação financeira com diagnóstico read-only aprovado.
- [ ] Autorização explícita separada para merge/deploy/ativação comercial. Nenhuma concedida nesta etapa.

Não houve push, merge, deploy, produção, cobrança real, Fase 7 ou ativação jurídica/comercial por suposição.
