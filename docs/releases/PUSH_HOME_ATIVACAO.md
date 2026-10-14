# Push na Home — ativação direta e boas-vindas

**Publicação autorizada pelo usuário em 14/10/2026:** “Vamos subir todas as correções a produção agora”. Rollout: worker, duas migrations e frontend. A versão anterior é o commit `2a2d274`. O registro final da publicação será salvo em `PUSH_ATIVACAO_DIRETA_PUBLICACAO.md`.

## Diagnóstico e correção

A Home usava `preferenceOff = status.enabled === false` para substituir **Ativar** por **Ver no Perfil**. A mesma substituição ocorria durante verificação/falha com permissão concedida. A RPC `get_my_push_status` devolvia `false` tanto sem preferência quanto com desligamento voluntário. `register_push_subscription`, corretamente compartilhada com o sync, não podia religar essa preferência. O worker fazia fan-out por usuário, portanto uma boas-vindas comum atingiria outros aparelhos.

A solução mantém o registro automático sem poder de consentimento. O clique usa uma RPC específica, autenticada e atômica, e a boas-vindas recebe segmentação explícita na outbox existente. Não há novo SDK, tabela, serviço, segredo, fila ou canal Realtime.

## Fluxo final

1. Usuário elegível vê **“Receba seus lembretes e novidades por aqui.”**, **Ativar** e X na mesma faixa compacta. `default` não consulta Supabase na montagem. Erro de verificação e preferência desligada também oferecem ativação direta, sem navegação.
2. O clique muda para **Ativando...**. Em `default`, `requestPermission()` começa sincronamente no gesto, antes de SW/rede; em `granted` não há novo prompt. SW é preparado antecipadamente por leitura local.
3. O serviço recupera/cria a subscription e chama `activate_push_subscription` com os mesmos seis parâmetros da inscrição. O servidor valida sessão, conta ativa, verificação/restrições/termos e endpoint/chaves, registra e habilita a preferência, preservando categorias.
4. O serviço confirma novamente `get_my_push_status(endpoint)`: exige `thisDevice=true` e `enabled=true`. Só depois limpa o opt-out e mostra **Notificações ativadas!**. Mudança de aba durante o prompt não invalida a ação nem duplica consulta.
5. A RPC solicita uma boas-vindas fixa e segmentada no pipeline real. A UI diz **Teste de boas-vindas solicitado**, ou informa indisponibilidade/categoria/limite. Isso não afirma entrega. Falha de fila não desfaz ativação válida.
6. O feedback acessível dura oito segundos, fora do fluxo do layout, sem bloquear cliques. Recusa de permissão também recebe orientação temporária na Home. Nenhuma notificação do sistema é criada pela página.
7. O cron existente processa a outbox a cada minuto. Worker → provedor Web Push → Service Worker → ACKs de recebido/exibido/clicado continuam no pipeline existente. Clique da boas-vindas abre `/`.

**A dispensa diária permanece intacta:** mesmo helper, armazenamento por conta/contexto, calendário São Paulo + mínimo de 12 horas e zero RPC ao fechar. Opt-out explícito continua sem banner/reinscrição automática; reativação voluntária segue disponível no Perfil. Offline, sessão/termos pendentes, conta bloqueada e falta de APIs não iniciam ativação. iOS fora do PWA recebe instrução de Tela de Início. `denied` nunca solicita permissão novamente.

## Contratos e isolamento entre dispositivos

- `20261102000001_push_welcome_type.sql`: enum `push_welcome`, em transação separada para permitir seu uso na migration seguinte.
- `20261102000002_push_explicit_activation_welcome.sql`: RPC pública **activate_push_subscription**, `SECURITY DEFINER`, `search_path=''`, execução apenas para `authenticated`; nenhum parâmetro de usuário, conteúdo ou destino livre. Helper de escrita privado não é executável por clientes.
- `get_my_push_status` acrescenta **preferenceExists** e **registrationAllowed**; mantém o contrato anterior. `register_push_subscription` conserva sua assinatura, mas nunca seleciona o caminho explícito de ativação. `unregister_push_subscription` conserva o comportamento, com o mesmo lock por conta.
- Consentimento é serializado por conta e por endpoint. Uma ativação não pode apropriar endpoint **ativo** de outra conta; revogação/reassociação legítima conserva os controles existentes. Confirmação e cache são vinculados à conta; respostas antigas são ignoradas/canceladas.
- Ao religar uma preferência global que estava `false`, os demais endpoints da conta permanecem revogados e recebem `activation_required`. A preferência `explicit_devices_only` impede que esses aparelhos burlem a escolha gerando endpoint novo pelo sync. Somente ativação voluntária libera o endpoint escolhido. Categorias não mudam.
- Consequência intencional: após esse desligamento global, até um aparelho sem subscription local precisa de clique para voltar. A escolha não é inferida da contagem de dispositivos nem do simples `granted`.

## Boas-vindas, limites e telemetria

Payload fixo no catálogo de mensagens:

- Título: **💚 Boas-vindas ao Evolutus!**
- Corpo: **Obrigado por usar o Evolutus! As notificações estão ativadas neste dispositivo.**
- Destino: `/`, ícone/badge PWA existentes.

Uma notificação interna técnica é criada **já lida e arquivada**, sem incrementar o sino ou aparecer na lista. Ela sustenta as FKs e a telemetria existentes. Na mesma transação, sua outbox recebe `target_subscription_id`, `target_activation_at` e `expires_at`; nada é visível ao worker antes disso. O claim filtra tanto criação quanto retorno de deliveries para impedir fan-out desse tipo, e cancela entregas incompatíveis.

`explicit_activation_at`/`welcome_requested_at`, locks e o índice único existente garantem uma solicitação por episódio. Repetir clique/RPC/aba/reload não cria outra. Reativação antes de 24 horas não solicita outra mensagem. Limites adicionais por conta usam `private.push_state`: **5 solicitações/hora e 10/dia UTC**, incluindo rotação de endpoints. Rate limit afeta somente o teste, não a ativação.

A categoria `account` e o interruptor geral são respeitados, sem bypass de categoria crítica. O claim reavalia preferência, revogação, episódio, conta, restrições e termos. Validade absoluta de **10 minutos**, inclusive na fila/retry: o worker calcula o TTL restante, limita a 600 segundos e não envia mensagem vencida/sem prazo. As opções dos demais tipos de Push são preservadas.

A linha do tempo existente permite verificar fila, tentativa, aceite HTTP do provedor, ACK do SW e clique. Aceite do provedor não prova exibição; retries de transporte mantêm o mesmo ID/tag de notificação. Não se promete entrega exatamente uma vez pelo navegador/provedor.

## Arquivos alterados

- `PushActivationNotice.jsx`, CSS e `useDevicePush.js`: CTA direto, feedback acessível e estabilidade da ação durante mudança de visibilidade; sem alterar calendário.
- `PushNotificationSettings.jsx`: reativação explícita real e orientação correta sobre os demais aparelhos.
- `pushService.js`: RPC explícita só no enable; sync/read não a chamam; leituras durante ativação aguardam a confirmação já em andamento.
- Migrations acima e `supabase/rollbacks/20261102000002_disable_push_explicit_activation.sql`: contrato, segmentação, limites e rollback operacional.
- `messages.js` e `processor.js`: payload fixo e TTL absoluto de boas-vindas; pipeline e SW mantidos.
- Testes de serviço, pgTAP `push_explicit_activation_test.sql`, `welcome.test.js`, `activation.integration.test.js` e harness `scripts/verify-push-home-browser.mjs`.

## Evidências e limites

Resultados finais detalhados em **PUSH_ATIVACAO_DIRETA_EVIDENCIAS.json**:

- JavaScript: **1.939/1.939**; serviço/calendário/logout direcionados: **65/65**.
- Funções com integração SQL habilitada: **156/156**, sem skips; execução padrão: 153 aprovados e três integrações ignoradas por ausência de `PG_TEST_CONTAINER`.
- Chromium: **29 cenários aprovados**. Faixa padrão: **58 px** nas larguras medidas, ambos os temas; CLS isolado zero no carregamento e 0,000484 na confirmação atrasada, sem deslocar o treino. Não foi medido CLS/LCP da Home completa.
- SQL: **477 asserções em 11 suítes**, 476 aprovadas e uma falha preexistente reproduzida na baseline; **58/58** na suíte nova. Rollback operacional ensaiado e aprovado.
- Lint: zero erros, 14 avisos preexistentes; build, budget, Prettier dos arquivos alterados e `git diff --check` aprovados.
- Boot gzip: JS **310.015 → 310.124 bytes** (+109 bytes); CSS **74.043 → 74.043 bytes**, quatro arquivos. Dashboard JS **42,44 → 42,57 kB** (gzip **14,98 → 14,96 kB**); CSS **1,68 → 1,92 kB** (gzip **0,65 → 0,75 kB**). Sem atualizar baseline de budget.
- Zero RPC ao montar em `default`; ativação faz **duas RPCs** (ativação + confirmação). Releituras durante o prompt aguardam a mesma operação. Nenhuma dependência, polling ou Realtime novo.

Comandos:

```bash
npm test
npm run test:functions
npm run lint
npm run build
npm run budget
npm run format:check
node scripts/verify-push-home-browser.mjs
PG_TEST_CONTAINER=evolutus_push_activation_test PG_TEST_USER=supabase_admin \
  node --test --test-concurrency=1 supabase/functions/*/*.test.js
# Banco Docker descartável, sem rede e com cron.launch_active_jobs=off:
docker exec -i evolutus_push_activation_test psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 \
  < supabase/tests/push_explicit_activation_test.sql
```

As conexões SQL e locks foram reais; dez ativações simultâneas produziram uma mensagem destinada a um aparelho, com três workers concorrentes. Outra corrida entre contas não sobrescreveu o vencedor. O worker real alimentou o código real do Service Worker em VM e seus ACKs foram persistidos no PostgreSQL. **Provedor e evento de entrega foram simulados**: isso não homologa criptografia/entrega externa ou aparelho físico.

Chromium usa componentes/CSS reais com APIs e RPCs simuladas, em 320/390/430/1366 px e temas claro/escuro. Valida CTA com permissão concedida/preferência desligada, recuperação de erro, opt-out, duas abas, calendário + 12h, gesto nativo, visibilidade durante a ação, sucesso temporário e recusa de permissão. Sem overflow. Não foram usados `new Notification`, `alert` ou `showNotification` da página como teste de entrega.

### Pendência preexistente comprovada

A suíte `notification_security_test.sql` falha na asserção 52: `cast_vote` e `create_promotion` têm `search_path=public`, fora da regra global do teste. O resultado foi reproduzido em **outro banco vazio com todas as migrations anteriores, sem as duas migrations desta tarefa** e confirmado no schema de produção salvo antes do rollout. Essas funções não foram alteradas nesta publicação de Push; a pendência permanece documentada. A suíte nova verifica os privilégios e search_path do contrato de ativação e passa.

`format:check` global segue falhando nos 122 arquivos preexistentes; os arquivos alterados estão formatados. Lint mantém 14 avisos antigos, sem erros. Build mantém o aviso existente sobre tamanho do chunk Primer. Safari/iOS PWA, Firefox, Android físico e entrega pelo provedor não foram homologados. Não houve testes invasivos, mensagens ou migrations em produção.

## Publicação e rollback — somente após autorização

1. Confirmar novamente remoto `Danielalveslira/treinos_academia`, identidade GitHub, branch, projeto Vercel e projeto Supabase corretos; revisar SQL/diff e recuperação disponível. Não reaproveitar tokens inválidos nem trocar destinos por suposição.
2. Publicar **primeiro o worker** atualizado: compatível com o schema e tipos atuais, ainda sem produtor de boas-vindas. Não alterar secrets, cron, filas ou permissões gerais.
3. Aplicar a migration de enum e concluir sua transação; depois aplicar a migration do contrato em transação própria. `lock_timeout=5s` evita esperar indefinidamente por locks. Nenhuma migration histórica foi editada.
4. Publicar o frontend validado. O frontend antigo continua compatível com o schema novo. Se o frontend novo encontrar a RPC ausente, apresenta erro recuperável e não cai no registro legado para burlar preferência.
5. **Homologação real pendente:** em conta e aparelho de teste expressamente autorizados, tocar Ativar na Home, confirmar status, conferir um único destino na outbox, aguardar cron/provedor dentro do TTL, verificar ACK `shown` e clicar para abrir `/`. Testar segundo plano/fechado e confirmar que outro aparelho não recebeu. Não chamar `shown` manualmente para aparentar homologação.
6. Rollback: restaurar o frontend anterior; executar o arquivo de rollback revisado, que revoga a RPC nova, desliga apenas o tipo de boas-vindas e cancela seus jobs/deliveries pendentes. Só então, se necessário, restaurar o worker anterior. O pipeline comum continua funcionando.

O rollback foi ensaiado localmente, incluindo tentativa de chamada sem grant e continuidade de Push comum. **Retém enum, colunas, recibos e holds de consentimento**, preservando escolhas já feitas. Remover um valor de enum exigiria recriação arriscada do tipo, portanto não faz parte do rollback operacional. Com o recurso revertido, endpoints em hold continuam sem reativação automática; a retomada exige reabilitar o contrato revisado. Não usar `migration repair` para apagar o histórico aplicado.

Alterações preexistentes em documentos de outros trabalhos foram preservadas e não integram esta publicação. A homologação física da entrega continua pendente, conforme descrito acima.
