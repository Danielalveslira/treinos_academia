# Push na Home — implementação e refinamento visual

## Diagnóstico

A ativação só estava disponível no Perfil. O serviço aguardava o Service Worker antes de pedir permissão, limpava o opt-out antes da confirmação e não exigia `enabled=true`. O Perfil também não verificava a preferência global. O sync do Layout usava um gate menos restritivo que o da sincronização offline.

## Implementação

- `PushActivationNotice.jsx` e `pushActivationNotice.css`: faixa abaixo da saudação e antes do anúncio. Texto curto, sino de 16 px, ação textual **Ativar**, X centralizado, tema existente, foco visível, alvos de 44 px e hover discreto com redução de movimento respeitada. Sem gradiente, sombra ou dependência nova.
- `pushNoticeSchedule.js`: dispensa com apenas `{day, at}`, chave por conta/contexto web/PWA, fallback em memória, reparo de dados inválidos, harmonização de abas e um único timeout até a elegibilidade. Requer próximo dia em São Paulo **e** 12 horas transcorridas. Nenhuma RPC no X.
- `useDevicePush.js`: estado e ações compartilhados pelo Perfil e Home, efeitos com cleanup e descarte de resultados após desmontagem/troca de identidade.
- `pushService.js`: pedido nativo síncrono no clique, preparação local do SW, exclusão de operações concorrentes, cancelamento por mudança de contexto, timeouts, confirmação do endpoint **e** preferência habilitada. Opt-out só é limpo depois da confirmação. Cache em memória por conta e endpoint, revalidação local e deduplicação das leituras.
- `PushNotificationSettings.jsx`: status verdadeiro, desativação explícita por dispositivo, orientação para permissão bloqueada/iOS e explicação dos limites de entrega.
- `Layout.jsx` / `usePushSubscriptionSync.js`: preservam a janela de 30 minutos; exigem sessão autorizada, conta ativa e gate legal permitido; não iniciam sync offline.

O refinamento visual posterior alterou somente apresentação/textos e o harness de navegador; não mudou regras de Push, permissão, storage ou calendário.

### Reserva de layout

No carregamento frio com permissão já concedida e sem confirmação em cache, uma faixa compacta mostra a verificação e vira informação de estado, sem convite ao confirmar ativo. A reserva móvel desse estado é 84 px. Ao ativar pelo clique ou voltar do Perfil com confirmação em cache, o convite desaparece. O estado comum `default` não depende de fetch para renderizar.

## Estados

| Contexto | Resultado |
| --- | --- |
| default | Convite local; sem RPC/popup na montagem; permissão apenas no clique |
| granted + endpoint + thisDevice + enabled | Sem convite; Perfil confirma ativo; cache evita consultas duplicadas |
| granted sem vínculo local | Reconciliação única, sem popup, somente com preferência já habilitada |
| outro dispositivo | Nunca infere ativação pela contagem da conta |
| denied | Sem convite recorrente; Perfil orienta configurações; nenhum novo pedido nativo |
| iOS fora do PWA | Instrução de Tela de Início, inclusive quando as APIs não estão expostas |
| sem suporte | Home normal e informação no Perfil |
| offline / conta bloqueada / termos ou sessão pendentes | Sem convite e sem RPC |
| opt-out explícito | Sem convite nem reinscrição automática; reativação voluntária pelo Perfil |
| erro de verificação | Recuperação contextual, sem sucesso falso |
| preferência global desabilitada | Nenhuma religação automática; confirmação de ativação falha com mensagem específica |

O contrato atual devolve `enabled=false` tanto sem linha de preferências quanto com preferência desligada. O Perfil permite o registro voluntário: ele cria o padrão apenas quando ausente e nunca sobrescreve uma preferência desligada. Não existe RPC pública para religar a preferência global no contrato atual; a interface orienta Atendimento nesse caso, sem ampliar privilégios.

## Segurança e infraestrutura

As RPCs e sua identidade `auth.uid()` permanecem inalteradas. Antes das etapas assíncronas sensíveis, o serviço valida a identidade da sessão e a geração da operação. Mudança de conta, logout, desativação e fechamento do contexto autorizado cancelam operações pendentes e requisições canceláveis. Endpoint/chaves ficam apenas no fluxo Push existente e em memória, nunca no calendário do aviso. Mensagens de produto não expõem detalhes técnicos; `describePushError` continua sanitizado.

**Sem migrations necessárias.** Não foram alterados fila, worker, antispam, tags, ACKs, RLS, rotas de notificationclick, precache ou sincronização de treinos.

## Evidências

Comandos e medições finais estão em `PUSH_HOME_ATIVACAO_EVIDENCIAS.json`. O harness `node scripts/verify-push-home-browser.mjs` usa componentes/React/CSS reais em Chromium, com sessão, APIs Push e RPCs simuladas, servidor exclusivamente local e nenhuma entrega externa. Capturas e resultados completos ficam no caminho `/tmp/push-home-browser-*` registrado no JSON.

- Faixa comum: **58 px** em 390/430/1366 px; **70,53 px** em 320 px, em ambos os temas. Reservas anteriores ao refinamento: 178 px desktop / 248 px mobile.
- Sem overflow horizontal; CTA e X com alvos de pelo menos 44 px.
- `default`: zero chamadas RPC e zero prompts na montagem, fechamento e refresh.
- `granted` inscrito: uma leitura `get_my_push_status`, compartilhada entre Home e sync; zero registro redundante. O fluxo anterior fazia um registro no sync.
- CLS do componente isolado: zero nas oito combinações de largura/tema e na confirmação atrasada. A posição do bloco de treino não mudou durante essa confirmação.
- Bundle inicial gzip: JS **308.096 → 310.015 bytes** (+1.919 bytes, aproximadamente 0,62%); CSS **74.043 → 74.043 bytes**, quatro arquivos. Budget aprovado sem alterar baseline. Chunk Dashboard: **39,16 → 42,44 kB**; gzip **13,69 → 14,98 kB**. CSS lazy novo: **1,68 kB / 0,65 kB gzip**.
- Nenhum setInterval ou canal Realtime novo. Um timer diário apenas enquanto a dispensa aguarda elegibilidade; listeners locais com cleanup e um observador de autenticação do serviço compartilhado.

As medições não são Lighthouse/LCP/CLS da Home completa. Safari/iOS PWA, Firefox e Android físicos e entrega real pelo provedor **não foram validados**. Não houve disparo para usuários de produção nem alterações em dados reais.

## Validação e publicação

**Resultados finais:** `npm test`: 1.934/1.934; `npm run test:functions`: 151 aprovados e um ignorado (152 no total); `node scripts/verify-push-home-browser.mjs`: 23 cenários; testes direcionados de Push/calendário/logout: 60/60. `npm run lint`, `npm run build` e `npm run budget` concluídos sem erros. Prettier direcionado e `git diff --check` aprovados.

A suíte inclui calendário/storage, permissão síncrona, confirmação, preferência global, erros por etapa, opt-out, concorrência, troca de conta e logout travado. A matriz Chromium cobre também dois contextos de conta, evento real de storage entre abas, timer de 12 horas com a Home aberta, iOS simulado, offline e gates de acesso.

`format:check` já falhava antes em 126 arquivos; os arquivos JS/JSX alterados foram formatados, sem reformatação geral. Permanecem 122 arquivos preexistentes fora do padrão. Lint mantém 14 avisos preexistentes, sem erros. O build mantém o aviso já existente de chunk Primer acima de 500 kB.

Este relatório registra a validação anterior à publicação. O resultado da publicação autorizada será registrado em `PUSH_HOME_PUBLICACAO.md`. Alterações preexistentes em documentos permanecem fora deste release.
