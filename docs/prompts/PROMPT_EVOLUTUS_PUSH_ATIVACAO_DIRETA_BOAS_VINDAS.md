# EVOLUTUS — CORREÇÃO DO PUSH NA HOME: ATIVAÇÃO DIRETA + BOAS-VINDAS REAIS

**Projeto:** Evolutus (`treinos_academia`), React/Vite PWA, Supabase/PostgreSQL, Web Push e Service Worker próprio.  
**Prioridades:** experiência mobile, simplicidade, performance, consentimento explícito, segurança e ausência de regressões.  
**Tarefa:** auditar a implementação atual e **executar a correção completa**, incluindo testes e documentação. Não entregar apenas sugestões.

## 1. Problema observado em produção

Em um aparelho Android, o banner da Home aparece com a mensagem:

> "Consulte o Perfil para concluir o registro deste dispositivo. Preferências já desabilitadas serão respeitadas."

E oferece **"Ver no Perfil"**. Isso frustra exatamente a finalidade do convite: a pessoa precisa navegar para outra página e procurar a ação de Push no final do Perfil.

**Resultado obrigatório:** quando o navegador permite Web Push e o usuário está elegível, tocar em **"Ativar" na Home deve executar TODO o fluxo de ativação naquele mesmo lugar**, solicitar a permissão nativa do navegador se necessária, registrar o dispositivo, confirmar o estado real no backend e mostrar o sucesso. **Não redirecionar ao Perfil como caminho principal.**

Após a primeira ativação efetiva por uma ação explícita, o usuário deve receber **uma notificação Web Push REAL de boas-vindas no dispositivo recém-ativado**, entregue pela infraestrutura do Evolutus (e não apenas um toast, alerta local ou simulação do navegador).

## 2. Auditoria obrigatória ANTES de alterar

Trabalhe sobre a **branch e o código atuais**, não sobre suposições. Inspecione, no mínimo:

- `src/features/notifications/components/PushActivationNotice.jsx` e respectivo CSS (localizar caminhos reais).
- `src/features/notifications/hooks/useDevicePush.js` e quaisquer hooks/serviços compartilhados atuais.
- `src/features/notifications/services/pushService.js` e `PushNotificationSettings.jsx`.
- `src/features/notifications/hooks/usePushSubscriptionSync.js`, Home/Dashboard e Layout.
- `scripts/service-worker.js`, geração/registro do SW e mensagens `push` / `notificationclick`.
- RPCs `register_push_subscription`, `get_my_push_status`, `unregister_push_subscription`, preferências e opt-out.
- `push_notification_preferences`, `push_subscriptions`, `notifications`, `notification_push_outbox`, `notification_push_deliveries` e RLS.
- `supabase/functions/process-push-outbox/`, catálogo/tipos de notificação, modelos de mensagens, worker, agendamento, antispam e telemetria.
- `docs/releases/PUSH_HOME_ATIVACAO.md` e testes existentes.

**Pista relevante do estado anterior:** `get_my_push_status(p_endpoint)` retorna `enabled`, `thisDevice` etc.; a RPC de registro cria preferência ausente, mas **não religa uma preferência explicitamente desabilitada**; `enabled=false` pode corresponder tanto à ausência de linha quanto ao desligamento. Isso foi apontado pela implementação anterior como motivo para direcionar ao Perfil. **Confirme no código atual se esta ainda é a causa, sem presumir.**

Apresente um diagnóstico curto: condição exata que gera "Ver no Perfil", origem do bloqueio, contratos envolvidos e alteração mínima segura para resolver. Depois **implemente**.

## 3. UX exigida — ativação em um toque, dentro da Home

### Estado padrão elegível

- Manter a faixa **compacta, minimalista, discreta e adaptada ao tema**; nada de card alto, gradiente, sombra pesada ou modal obrigatório.
- Texto sugerido: **"Receba seus lembretes e novidades por aqui."**
- Ação principal claramente identificável: **"Ativar"**; X para dispensar conforme a lógica diária já existente.
- No clique, o botão passa para **"Ativando..."**, evita cliques duplicados, e o fluxo permanece na Home.
- `Notification.requestPermission()` deve ser iniciado no **gesto real do usuário**, sem `await` de rede/Service Worker antes dele que possa perder a ativação transitória; preparar o SW previamente de forma não intrusiva se necessário.
- Se a pessoa conceder permissão: recuperar/criar inscrição Web Push, registrá-la com autenticação, validar `thisDevice === true` **e** `enabled === true`, e só então exibir **"Notificações ativadas!"**.
- Após confirmação, remover o convite e deixar feedback de sucesso temporário/acessível; não afirmar que a mensagem de boas-vindas foi entregue até existir evidência real.
- **Não usar navegação para o Perfil para concluir o fluxo normal.** Perfil continua como opção para configurações avançadas/desativação.

### Exceções e estados

| Estado | Resultado obrigatório |
| --- | --- |
| `default`, suportado, online e elegível | CTA direto **Ativar** na Home |
| `granted`, ainda sem endpoint confirmado | CTA **Ativar** executa o registro/reconciliação com confirmação real (sem popup nativo desnecessário) |
| `granted` + `thisDevice` + `enabled` | Convite não aparece; não reenviar boas-vindas |
| `denied` | Não tentar contornar permissão; orientação curta para configurações do navegador, sem falsas promessas |
| iOS Safari fora do PWA | Orientar a adicionar à Tela de Início; não prometer ativação impossível no contexto atual |
| Sem suporte/Web Push indisponível | Não apresentar CTA impossível; informação contextual não invasiva |
| Offline, sessão inválida, conta bloqueada ou gate legal pendente | Não iniciar registro/RPC; recuperar sem loop quando elegível |
| Preferência global desabilitada | Se houve clique explícito **Ativar**, oferecer ativação efetiva por caminho autenticado, preservando as restrições abaixo; não mandar ao Perfil como substituto |
| Opt-out explícito anterior no dispositivo | **Não ressuscitar automaticamente** nem insistir com banner; se o usuário decidir reativar voluntariamente por um controle permitido, essa ação explícita poderá reabilitar com segurança |
| Falha de rede/backend/timeout | Permanecer na Home, mensagem amigável e possibilidade de tentar novamente; não marcar sucesso nem limpar opt-out prematuramente |
| Mudança de conta/logout durante a operação | Cancelar/invalidar operações tardias e nunca associar inscrição à conta errada |

**A regra de fechar com X e reaparecer no próximo dia elegível após pelo menos 12 horas permanece INTACTA.** Nenhuma permissão é solicitada na montagem, no refresh ou ao fechar.

## 4. Corrigir o contrato de preferência com segurança

A UX não pode ficar bloqueada por `enabled=false` genérico, mas **não é permitido religar Push silenciosamente** em login, mount, sync, reconexão ou refresh.

Requisitos:

1. Separar conceitualmente **sem preferência cadastrada**, **preferência desativada deliberadamente**, **dispositivo não inscrito**, **opt-out local explícito** e **conta inelegível**. Não inferir consentimento a partir da contagem de dispositivos.
2. No clique em **Ativar**, há consentimento explícito. Se a preferência global precisa ser habilitada para entrega, implementar o menor caminho seguro para habilitá-la **apenas nessa ação voluntária**, junto ao registro/validação do dispositivo.
3. Priorizar reaproveitar RPC existente, se ela já oferece operação explícita autorizada. Caso não exista, considerar **uma RPC `SECURITY DEFINER` estreita e autenticada**, com `auth.uid()`, `search_path` restrito, `GRANT EXECUTE` só para `authenticated`, validação de sessão/conta/endpoint e proteção contra concorrência. Evitar escrita direta ampla em tabelas e **nunca** expor `service_role` ao cliente.
4. A operação deve ser idempotente e, preferencialmente, atômica nas mutações do banco: evitar preferência ligada com registro inválido após erro parcial. Permissão recusada não altera preferência.
5. Não mudar silenciosamente preferências de categoria ou reativar outros dispositivos previamente desativados. **Avaliar o efeito de `enabled=true` nos outros dispositivos ativos da conta**; impedir reativação inesperada ou informar/obter consentimento compatível. Preservar os opt-outs e a política existente de desligamento.
6. Limpar o opt-out local **somente após** confirmação de ativação voluntária e bem-sucedida. Sync em background nunca deve ignorá-lo.
7. Caso seja necessária migration, criar migration nova, incremental e reversível; **não editar migrations históricas aplicadas**. Revisar RLS, grants, assinatura da RPC e privilégios mínimos.

Se um bloqueio concreto inviabilizar a ativação direta sem impacto indevido sobre outras contas ou dispositivos, documente-o claramente e proponha uma correção de contrato específica. **Não maquiar o problema trocando a mensagem do banner.**

## 5. NOVO RECURSO — Web Push real de boas-vindas ao ativar

Após a confirmação do Push no backend, criar uma mensagem de teste/boas-vindas, por exemplo:

- **Título:** `💚 Boas-vindas ao Evolutus!`
- **Corpo:** `Obrigado por usar o Evolutus! As notificações estão ativadas neste dispositivo.`
- **Clique:** abre uma rota interna segura, preferencialmente a Home (`/`).
- Usar ícone/badge PWA já existentes e tom simples, sem propaganda nem excesso de emojis.

**A mensagem precisa ser Web Push real:** enfileirada/enviada pelo backend e recebida pelo Service Worker, inclusive quando o app estiver em segundo plano ou fechado, dentro dos limites reais do navegador/SO. É expressamente proibido substituir por `alert()`, toast, `new Notification()` da página ou `registration.showNotification()` como se isso validasse a entrega externa.

### Integração obrigatória

- Usar o pipeline real existente: **Supabase → outbox/entrega → `process-push-outbox` → provedor Web Push → Service Worker**. Reutilizar o catálogo de tipos, gerador de mensagens, retry, antispam, telemetria e regras de elegibilidade sempre que possível.
- A emissão deve nascer de uma **ação de ativação autenticada e validada no servidor**. Cliente não pode escolher texto arbitrário, outros `user_id`, outros endpoints ou destinatários.
- **Destino: somente a inscrição do dispositivo recém-ativado**, nunca broadcast para todos os usuários nem fan-out involuntário para os demais dispositivos. Verificar se o worker atual faz fan-out por usuário; se fizer, adaptar pelo menor mecanismo de segmentação seguro em vez de presumir entrega por endpoint.
- **Idempotência:** 1 boas-vindas por episódio de ativação efetiva do dispositivo, com prevenção de duplicatas em cliques rápidos, reload, duas abas, corrida de requests e retries. Estabelecer limite conservador de reenvio (ex.: 24h), sem enviar novamente em sync automático.
- **TTL curto** para o teste (ex.: 5–15 minutos); não entregar uma mensagem de boas-vindas antiga dias depois. Respeitar limites de provedor, categoria e preferências efetivas.
- Falha/atraso no envio de boas-vindas **não deve desfazer a ativação válida**. UI diferencia claramente: `Ativado` de `Teste de boas-vindas solicitado` ou `Não foi possível enviar o teste agora`.
- Telemetria existente deve permitir rastrear solicitação, fila, tentativa, aceite do provedor, ACK do SW e clique quando disponíveis. **Aceite do provedor não equivale a exibição garantida na tela**.
- O usuário não precisa configurar mais nada no Perfil para receber esse teste.
- Se a arquitetura atual exige criar uma notificação interna para disparar o Push, decidir explicitamente se a boas-vindas também aparecerá no sino. Evitar poluir a Central ou gerar contadores enganosos; caso registrada, torná-la idempotente e semanticamente correta.

## 6. Privacidade, segurança e resistência a abuso

- `auth.uid()` sempre determina o destinatário; usuário não pode solicitar push para terceiros.
- Não adicionar endpoint externo arbitrário, SSRF, geração de conteúdo livre pelo cliente, nem exposição de chaves VAPID privadas ou `service_role`.
- Preserve a validação de endpoints permitidos, revogação, proteção contra mudança de conta e limpeza de inscrições inválidas.
- Não vazar endpoint, `p256dh`, `auth`, token de ACK nem dados pessoais em banners, notificações, URLs ou logs públicos.
- Validação de preferência global, elegibilidade, opt-out e endpoint deve ser refeita também no **momento de envio**, não apenas quando solicitado.
- Rate limit/idempotência precisam existir no servidor, não apenas em `disabled={busy}` no React.
- Não disparar teste em refresh, login, SW update, troca de rota ou re-sync periódico.
- Não criar endpoint público de envio de Push genérico; se RPC específica for necessária, permissões estritas e payload fixo.

## 7. Performance e simplicidade (requisitos de aceite)

- **Sem dependências novas** sem justificativa incontornável.
- Reaproveitar `useDevicePush`, cache de status, `enablePushNotifications` e componentes/estilos existentes; não duplicar estado entre Home e Perfil.
- Zero RPCs extras só para renderizar o convite em estado padrão; no fluxo de ativação, o mínimo de chamadas necessário.
- Sem polling, `setInterval`, Realtime novo ou consultas por renderização. Deduplicar operações concorrentes e limpar listeners/timers no unmount.
- Preservar lazy loading, baixo custo JS e responsividade, alvos de toque adequados, foco visível e `prefers-reduced-motion`.
- Faixa de altura próxima ao resultado atual (aprox. 58 px em telas comuns, crescimento necessário em 320 px), sem layout shift evitável.
- Não alterar notificações de treino/comunidade/admin nem contratos de sincronização offline fora do escopo.
- Não executar migrations nem alterar regras do banco se a solução segura puder reutilizar o contrato existente.

## 8. Testes obrigatórios

### Funcionais

1. Conta nova, Android/Chrome com permissão `default`: tocar **Ativar** → prompt nativo → registrar → `thisDevice=true`, `enabled=true` → convite some → fila gera 1 mensagem.
2. Permissão já `granted`, endpoint não registrado: tocar **Ativar** → registro direto, **sem** prompt redundante e sem Perfil.
3. Preferência global desligada: ativação **voluntária** na Home conclui corretamente quando autorizada, sem violar opt-out/segurança e sem ativar terceiros.
4. Clique em X → aviso some; não solicita permissão; regra dia seguinte + 12h preservada.
5. Permissão `denied`, iOS fora do PWA, navegador sem suporte, offline, sessão/gate inválidos: estado correto, sem solicitações ilegais ou loops.
6. Logout/troca de conta/duas abas/conexão lenta: não transferir inscrição entre contas nem registrar sucesso falso.
7. Desativação explícita e sync automático: nenhum retorno indevido do Push ou das boas-vindas.
8. Falha ao enfileirar ou enviar boas-vindas: ativação permanece correta; UI informa sem falso sucesso da entrega.

### Push real e antifraude

9. Confirmar que a mensagem percorre **o worker e o Service Worker**, não uma notificação local simulada.
10. Envio segmentado: apenas o novo dispositivo; os demais endpoints da conta não recebem o teste.
11. `double click`, duas abas, repetir requisição/RPC, reload e reprocessamento do worker: nenhuma duplicação.
12. RPC/Edge Function não permite usuários diferentes, mensagens customizadas, endpoints alheios, SSRF ou abuso por repetição.
13. TTL, categorias, RLS, grants, locks e deduplicação preservados; verificar SQL em ambiente de teste/local quando possível.
14. Testar payload fixo, título, corpo, destino seguro, ícones, `notificationclick` e telemetria.

### Qualidade

- Executar as suítes existentes (`npm test`, `npm run test:functions`, lint, build, budget, testes SQL de segurança e script Chromium de Push, conforme disponíveis).
- Adicionar testes focados de Home/Perfil/serviço/RPC/worker e atualizar mocks com responsabilidade.
- Conferir visual no mobile pequeno e no desktop; temas claro/escuro; sem overflow.
- Documentar o que foi **simulado** e o que foi validado **em aparelho físico**. Se não houver aparelho, não alegar entrega real homologada.

## 9. Atenção: sistema já está em PRODUÇÃO, sem homologação separada

- Trabalhe e rode testes **localmente**, com mocks ou banco Supabase local/isolado quando disponível. Não executar testes invasivos contra usuários/dados de produção.
- **Não realizar push, deploy, migrations em produção, alteração de secrets ou disparo de testes reais para contas existentes sem minha autorização explícita.**
- Caso migration seja inevitável: fornecer revisão do SQL, impacto, ordem de publicação, compatibilidade entre frontend/backend durante rollout e rollback.
- Ao preparar deploy, verificar antes `git remote -v`, identidade autenticada e repositório de destino correto; não trocar remote automaticamente.
- Planejar smoke test em **uma conta/dispositivo de teste autorizados**, com notificação real, antes de considerar concluída a homologação em produção.

## 10. Entregáveis e conclusão esperada

Entregar o código implementado **mais**:

1. **Diagnóstico da causa raiz** do estado "Ver no Perfil" e decisão técnica para `enabled=false`.
2. **Arquivos modificados e por quê**, com resumo objetivo dos contratos alterados.
3. **Fluxo final passo a passo** do clique em Ativar até a confirmação e o teste de boas-vindas.
4. **Detalhes de segurança e idempotência**, sobretudo preferência global, opt-out, segmentação por dispositivo e proteção da RPC.
5. **Testes executados, números, pendências e evidências reais**, separando mock de dispositivos reais.
6. **Impacto de performance** em bundle/RPC/renderizações e regressões detectadas.
7. **Plano de deploy e rollback seguro**, sem executar publicação não autorizada.
8. Atualização de `docs/releases/PUSH_HOME_ATIVACAO.md` (ou documento equivalente) refletindo o comportamento real.

### Critérios de aceite inegociáveis

- **Ativar na Home ativa de verdade**, sem mandar para Perfil no fluxo elegível.
- A ativação depende de **clique explícito** e termina com **confirmação real** do dispositivo/preferência.
- Ao ativar com sucesso, é solicitada **uma Web Push real de boas-vindas**, destinada ao dispositivo ativado, com anti-duplicação no servidor.
- Bloqueios e desativações anteriores são respeitados; **nenhuma ativação automática oculta**.
- Interface continua **minimalista e rápida**; nenhum serviço ou dependência desnecessária.
- Sem regressões de segurança, RLS, notificações anteriores, offline ou mudança de conta.
- **Não publicar automaticamente**; apresentar resultado e evidências para minha revisão.

**Implemente agora, com rigor, simplicidade e mudanças mínimas. Não considere um botão que apenas abre o Perfil como solução.**
