# Evolutus — Correção completa do logout global e revogação de sessões

## Papel e objetivo

Atue como engenheiro sênior de segurança e arquitetura, especializado em React, Supabase Auth, PostgreSQL/RLS, Edge Functions e aplicações PWA/offline-first. **Analise o código real antes de alterar qualquer arquivo** e implemente a correção completa da funcionalidade **“Sair de todos os dispositivos”** do Evolutus.

**Objetivo de segurança:** depois da revogação confirmada, sessões anteriores do **mesmo usuário** não podem continuar executando operações sensíveis no backend, ainda que seus JWTs não tenham expirado. A interface remota deve reconhecer a revogação ao voltar a ter conexão, encerrar o contexto privado e exigir novo login. Preservar o uso legítimo offline dentro de uma política explícita e limitada, sem fingir que um dispositivo fisicamente offline pode receber uma revogação imediatamente.

**Objetivo funcional:** corrigir concorrência, falsos sucessos, falhas parciais, mensagens de status, limpeza local, recuperação de senha e notificações Push sem regressões no logout comum, cadastro, sessão autenticada, PWA, cache e sincronização de treinos.

Não implementar mudanças apenas visuais, não mascarar falhas com `catch(() => {})`, não instalar um mecanismo de autenticação paralelo e não alterar políticas de acesso sem testes de regressão.

## Contexto verificado no repositório

O código usa `@supabase/supabase-js` e os seguintes pontos de entrada:

- `src/services/authService.js`: `logoutUser()`, `logoutAllDevices()`, `signOutLocal()`, `singleFlight()` e `endOtherSessions()`.
- `src/hooks/useLogout.js`: execução dos dois fluxos, confirmação, aviso de sucesso e timeout de Push.
- `src/components/AccountMenu.jsx`, `src/components/Layout.jsx` e `src/components/LogoutButton.jsx`: ações da interface.
- `src/contexts/AuthContext.jsx`, `src/utils/authSession.js`, `src/utils/logoutReason.js`: ciclo de sessão, limpeza de estado, boot e redirecionamento.
- `src/services/offline/bootstrap.js`, `src/services/offline/bootstrapEntry.js`, `src/services/offline/userScope.js`, `src/services/offline/rollout.js`: IndexedDB, autorização offline, tombstone e preservação da outbox.
- `src/features/notifications/services/pushService.js` e `src/features/notifications/hooks/usePushSubscriptionSync.js`: subscriptions e preferências Push.
- `src/hooks/useRecoveryTokenExchange.js`, `src/pages/ResetPassword.jsx`, `src/pages/ConfirmEmail.jsx`, `src/pages/Login.jsx`: recuperação de senha e login obrigatório.
- `supabase/config.toml`, `supabase/migrations/`, `supabase/functions/` e `supabase/tests/`: autenticação, RLS, RPCs, Edge Functions e testes de banco.

### Falhas reproduzidas com a lógica original

1. **Escopos concorrentes:** se `logoutUser()` inicia antes de `logoutAllDevices()`, `singleFlight()` entrega ao segundo pedido a promessa do primeiro. É possível retornar sucesso no pedido global executando **apenas** `signOut({ scope: 'local' })`.
2. **Sucesso não confiável:** `signOutLocal()` pode devolver `{ revoked: false }` após limpar a sessão local sem confirmação de revogação no servidor; `logoutAllDevices()` ignora esse retorno e responde `{ revoked: true }`.
3. **Falha parcial:** se `scope: 'others'` concluir, mas `disableOfflineAccess()` falhar com cold start habilitado, outras sessões já podem ter sido revogadas enquanto o dispositivo atual continua autenticado; o resultado não distingue adequadamente esse estado.

### Outros riscos observados

4. **Janela de JWT válido:** Supabase revoga refresh tokens, mas access tokens anteriormente emitidos seguem válidos até `exp`. `supabase/config.toml` define `jwt_expiry = 3600` localmente; a configuração hospedada deve ser verificada. Não foi identificada validação sistemática contra `auth.sessions` nos caminhos de banco analisados.
5. **Revalidação remota insuficiente:** `AuthContext` reage a eventos locais, mas apenas isso não identifica necessariamente revogação em outro dispositivo antes do refresh. `getSession()` e chamadas RLS que aceitam o JWT antigo não são prova de sessão ainda existente.
6. **Acesso offline sem limite temporal:** `evaluateOfflineEntry()` exige `last_online_verified_at` finito, mas não limita sua antiguidade; o bootstrap de um dispositivo remoto offline pode continuar abrindo o conteúdo local indefinidamente, dependendo do rollout.
7. **Recuperação de senha:** `useRecoveryTokenExchange()` estabelece sessão autenticada; `ResetPassword.jsx` altera a senha e navega para `/login` sem encerrar explicitamente a sessão atual, enquanto `Login.jsx` redireciona quem já está autenticado para `/app`. `endOtherSessions()` oculta falhas de revogação em fluxos sensíveis.
8. **Push best-effort:** a autenticação prossegue se a revogação Push falhar; o estado parcial e o comportamento no próximo login precisam ser auditados, respeitando `explicit_devices_only` e as migrations efetivamente aplicadas.
9. **Ausência de comprovação end-to-end:** testes atuais usam mocks de `signOut` e favorecem a ordem “global primeiro”. É necessária prova real com duas sessões, JWT anterior à revogação e RLS/RPC.

**Atenção à cronologia:** o ZIP contém migrations com nomes datados posteriormente a 23/10/2026. Não assumir que todas foram aplicadas ou que a última versão por nome representa a produção. Conferir `supabase_migrations.schema_migrations`, configuração Auth hospedada e ordem real antes de propor DDL. Não aplicar migrations destrutivas.

## Etapa 1 — Inventário e diagnóstico obrigatório

1. Rastrear todos os caminhos de logout, login, recuperação, confirmação de conta, troca de senha, exclusão/bloqueio e sessão expirada. Distinguir **logout local**, **logout global**, **revogação de outras sessões** e **perda de sessão por expiração**.
2. Levantar as chamadas reais a `supabase.auth.signOut`, `getSession`, `getUser`, `getClaims`, `onAuthStateChange`, RPCs e Edge Functions; mapear o que acontece em múltiplas abas, dispositivos e PWA instalada.
3. Inventariar tabelas privadas, policies RLS, RPCs `SECURITY DEFINER`, funções de carteira/EvoCash/EvoCoins, compras InfinitePay, administração, Storage, Realtime e endpoints de backend. Determinar quais aceitam JWT de sessão já revogada e quais realizam verificação de sessão ativa.
4. Identificar as migrations vigentes e a configuração hospedada da expiração de JWT e da política de sessões. Diferenciar código versionado de ambiente de produção.
5. Apresentar no relatório diagnóstico uma tabela **achado → evidência/arquivo/linha → risco → correção → teste**. Não modificar unrelated features.

## Etapa 2 — Corrigir a máquina de estados do logout

Implementar uma coordenação centralizada, testável e segura entre os escopos.

1. **Nunca reutilizar uma promessa de `logoutUser()` como resultado de `logoutAllDevices()`, ou vice-versa.** Deduplicar apenas operações equivalentes. Em operações incompatíveis, serializar com semântica correta **ou** rejeitar explicitamente com erro de conflito; jamais reportar que o escopo global foi executado se não foi. Considerar as duas ordens de concorrência.
2. Manter o fluxo normal de `logoutUser()` limitado ao dispositivo atual (`scope: 'local'`) e o botão global atrás de confirmação explícita.
3. Para o global, preservar a intenção de revogar outras sessões antes de encerrar a sessão corrente. Verificar, na versão real do SDK, o tratamento de falha do `scope: 'others'` e do `scope: 'local'`. Não depender do escopo implícito (`global`) nem substituir por ele sem demonstrar melhoria real de atomicidade/falhas.
4. Substituir o booleano ambíguo `revoked` por um **resultado discriminado** ou modelo de erro equivalente, com estados verificáveis: revogação das outras sessões, encerramento local, confirmação de revogação local e resultado de Push. Só marcar uma etapa como confirmada com evidência da operação correspondente.
5. Tratar separadamente: falha antes de revogar outras sessões; outras revogadas, sessão local ainda ativa; sessão local removida sem confirmação do refresh token; cleanup local falhou; Push falhou; resultado remoto desconhecido por timeout. O fluxo deve ser idempotente/reexecutável sem perda de dados.
6. Evitar falso sucesso em `useLogout.js` e `logoutReason.js`: avisos de “todos os dispositivos” só após conclusão confirmada das etapas necessárias. Proteger contra `SIGNED_OUT`/navegação que ocorra antes de a operação terminar e contra avisos residuais em nova sessão.
7. Permitir que a UI se recupere de erro sem spinner permanente, ações repetidas ou envio duplicado. Desabilitar corretamente os controles envolvidos durante a operação e centralizar proteção contra toques em múltiplos componentes.
8. Mensagens claras e fiéis ao resultado: **“Não foi possível confirmar a saída dos outros dispositivos”**, **“Outras sessões encerradas; falta concluir a saída deste dispositivo”**, **“Sessão local removida, mas revogação local não confirmada”** e **sucesso confirmado**. Não afirmar revogação que o servidor não confirmou.
9. Nunca registrar tokens, endpoints Push, dados pessoais ou payloads sensíveis nos logs de erro.

## Etapa 3 — Bloquear JWTs revogados nas operações sensíveis

Essa é a correção central de segurança. **Não é suficiente encurtar o tempo de expiração do JWT** e não é suficiente ocultar telas no React.

1. Investigar uma validação **server-side** usando o claim JWT `session_id`, confrontando com `auth.sessions.id` e vinculando-o também a `auth.uid()` / `auth.sessions.user_id`. JWT sem `session_id`, malformado ou sem sessão correspondente deve falhar de forma segura para as operações protegidas.
2. Para SQL/RLS, implementar helper mínimo e testável com `SECURITY DEFINER`, `search_path` fixo/restritivo e grants mínimos, ou alternativa segura equivalente. Não expor `auth.sessions` diretamente via Data API, não aceitar `user_id`/`session_id` como parâmetro arbitrário enviado pelo cliente e não dar `service_role` ao frontend.
3. Fazer a verificação ocorrer **no banco ou backend da operação**, não somente por chamada anterior do cliente a `getUser()`, evitando TOCTOU quando possível.
4. Priorizar: movimentação e leitura financeira privada (EvoCash/EvoCoins/carteira/compra), escrita de treinos e sync offline, funções administrativas, atualização de dados pessoais, publicação/edição e ações destrutivas. Inspecionar também `SECURITY DEFINER` e chamadas que usam `service_role`, não apenas RLS.
5. Nas Edge Functions autenticadas, verificar revogação no limite de confiança. Aproveitar `auth.getUser()` quando apropriado, documentando suas garantias reais, e manter autorização por papel/conta no servidor. Verificar que APIs internas, webhooks legítimos e processos de serviço não sejam bloqueados por ausência de sessão do usuário quando essa ausência for esperada.
6. Não aplicar consulta extra indiscriminadamente a **todas** as leituras públicas ou linhas RLS sem medir custo. Centralizar o guard onde a garantia importa e testar seu plano de execução. Preservar os acessos públicos legítimos, cron jobs, workers, webhooks, cadastro antes do aceite legal e suporte de contas bloqueadas.
7. Testar que uma requisição com token de sessão removida seja negada **antes do vencimento do JWT** nos endpoints protegidos, enquanto uma sessão válida com as mesmas permissões continua funcionando.
8. Documentar que dados já entregues ao dispositivo antes da revogação não podem ser apagados remotamente sem conectividade; não prometer logout visual instantâneo com o aparelho offline.

## Etapa 4 — Detecção de revogação e limpeza de estado nos clientes

1. Inspecionar `AuthContext` e adicionar revalidação autenticada com fonte autoritativa (ex.: `auth.getUser()` em pontos apropriados) no boot online, retorno ao foreground e reconexão. Usar controle de frequência/deduplicação e tratamento distinto de falha de rede, sessão revogada e erro transitório; não fazer polling agressivo.
2. **Não usar `getSession()` isoladamente como prova de sessão vigente no servidor.** Considerar também troca de sessão do mesmo usuário, `session_id` e múltiplas abas, sem reinicializar o aplicativo em cada `TOKEN_REFRESHED` legítimo.
3. Quando a sessão tiver sido inequivocamente revogada, impedir novas operações privadas, limpar estado em memória, caches descartáveis, carteira, canais Realtime, estado de Push e referências de perfil; redirecionar com aviso específico e `replace`.
4. Se a rede falhar, não declarar “sessão revogada” indevidamente; respeitar o modo offline limitado e fazer revalidação antes de retomar chamadas/sync. Controlar respostas assíncronas tardias para que não repovoem dados privados após logout ou troca de usuário.
5. Auditar o Service Worker, Cache Storage, IndexedDB e quaisquer dados persistidos no `localStorage`/`sessionStorage`, sem apagar preferências globais legítimas nem expor dados da conta anterior.

## Etapa 5 — Política explícita de acesso offline

1. Implementar uma janela máxima de idade do `last_online_verified_at` para a autorização de cold start offline, validando data futura, clock regressivo, registro inválido e bootstrap de versões antigas. **Adotar inicialmente 24 horas como limite conservador proposto**, configurável por constante de domínio e acompanhado de justificativa/testes; se o produto já tiver regra contratual diferente, documentar o conflito antes de alterá-la.
2. A checagem de validade temporal deve ser local, de baixo custo e falhar fechada para permitir acesso à interface privada offline. Não confundir autorização offline para dados locais com autorização para usar o backend.
3. Preservar rigorosamente a `outbox` e os treinos ainda não sincronizados, inclusive se a sessão expirar ou for revogada. **Negar acesso temporariamente não significa apagar trabalho pendente**; só sincronizar após novo login e confirmação do mesmo proprietário.
4. Respeitar `disableOfflineAccess()` e seu tombstone; testar gravações tardias e corridas entre logout, saveBootstrap, troca de conta e reconexão.
5. Explicitar a limitação física: um aparelho que nunca mais se conecta não tem como receber o logout remoto instantaneamente; o prazo offline limita o risco de reabertura no cliente honesto, mas não substitui proteção local do dispositivo nem armazenamento seguro.

## Etapa 6 — Recuperação e alteração de senha

1. Corrigir o fluxo de `ResetPassword.jsx`: após `verifyOtp` e `updateUser({ password })`, **encerrar corretamente a sessão de recuperação** se a UX exigir login explícito. Não apenas navegar para `/login` mantendo `user` autenticado.
2. Distinguir troca de senha concluída de revogação de outras sessões não confirmada. O usuário precisa receber status fidedigno, poder tentar novamente e não receber confirmação de “conta segura” sem evidência.
3. Auditar `endOtherSessions()`, `setPasswordAfterConfirmation()` e `ConfirmEmail.jsx`: evitar `best-effort` silencioso para revogação de segurança, mas não desfazer logicamente uma troca de senha que já ocorreu nem exigir redigitação desnecessária sem critério.
4. Testar recuperação com sessão anterior em outro aparelho, sessão temporária de recovery e redirecionamento ao login. Verificar que os fluxos de cadastro/OTP/confirmar e-mail não regridam.

## Etapa 7 — Notificações Push e idempotência

1. Manter o desligamento de Push subordinado à autenticação: falha de Push não pode bloquear indefinidamente um logout, mas deve gerar estado/log de diagnóstico apropriado, sem falso sucesso sobre Push.
2. Verificar no banco real as versões efetivas de `unregister_push_subscription`, preferências `enabled`, `explicit_devices_only`, subscriptions revogadas e jobs pendentes. O logout **não deve transformar uma preferência voluntária em opt-out permanente** nem reativar silenciosamente subscrição que exige opt-in.
3. Garantir que a revogação global não deixe jobs Push novos sendo entregues a endpoints revogados, observadas corridas com jobs já em processamento e as limitações de notificações já entregues.
4. Não executar `unsubscribe()` de um dispositivo diferente do atual. Tratar ausência de Service Worker, navegador incompatível, timeout, múltiplas abas e nova autenticação no mesmo navegador.

## Etapa 8 — Testes obrigatórios e validação de segurança

**Unitários e integração frontend**

- Dois logouts locais simultâneos: uma operação local, sem efeito sobre outras sessões.
- Dois logouts globais simultâneos: uma sequência global, sem repetição perigosa.
- **Local primeiro, global depois**, em corrida: o global não pode retornar sucesso sem revogar outras sessões.
- **Global primeiro, local depois**, em corrida: sem downgrade silencioso nem aviso incorreto.
- Revogação `others` falha: não afirmar sucesso e não encerrar sessão atual deliberadamente.
- `others` funciona e `local` falha: resultado parcial explícito e recuperação por retry.
- `others` funciona e `disableOfflineAccess` falha: estado parcial e nenhum aviso de sucesso.
- `signOutLocal()` retorna `revoked:false`: não converter para `revoked:true`.
- `SIGNED_OUT` chega antes de terminar operação; login não exibe motivo errado.
- Push falha, trava, não existe, ou subscription foi invalidada; operação de Auth conserva seus invariantes.
- Login após logout, múltiplas abas, troca de identidade, retorno online, logout remoto e revalidação de sessão do mesmo usuário.
- Bootstrap offline recente, expirado, registro legado, data futura, sem IndexedDB e outbox pendente preservada.
- Recovery troca senha, revoga outras sessões, encerra recovery session e exige novo login real.

**Integração com Supabase local e SQL**

- Criar duas sessões independentes **A e B** para o mesmo usuário. Guardar o JWT de B antes do logout.
- Executar logout global no A; verificar a revogação de B e testar **o JWT antigo de B antes de `exp`** em uma seleção privada, mutação sensível, RPC financeira e uma operação administrativa autorizada previamente. Devem negar corretamente.
- Repetir com A e B válidos e com usuário diferente para provar que não houve quebra de escopo, vazamento entre contas ou bloqueio indevido.
- Exercitar funções `SECURITY DEFINER`, RLS, operações com `service_role` (somente servidor) e recursos públicos que precisam permanecer acessíveis.
- Testar concorrência de revogação com requisição no banco, índice/plano da verificação de sessão ativa, custo de latência por request e volume de consultas.
- Validar regra de senha/OTP e signOut com GoTrue real, não apenas mocks.
- Verificar comportamento de Push com migrations efetivamente aplicadas e jobs na fila.

**Qualidade e comandos**

- Executar lint, testes JS, testes de Edge Functions, testes SQL/pgTAP aplicáveis, build Vite, verificações de offline/PWA e demais scripts existentes (`package.json`).
- Se dependências, Docker ou ambiente de integração estiverem indisponíveis, registrar os comandos tentados e evidências; **nunca declarar teste aprovado sem execução**.
- Garantir testes determinísticos, sem conexão real de produção, sem segredos versionados, com fixtures isoladas e limpeza de recursos.
- Fazer smoke test autenticado em ambiente de homologação antes do deploy e verificar rollback de migrations caso necessário.

## Etapa 9 — Requisitos não funcionais e restrições

- **Segurança:** fail-closed em operações protegidas; autorização sempre no backend; sem trust em `user_id`, `role` ou sessão informados arbitrariamente pelo cliente; nenhum segredo/token nos logs.
- **Performance:** evitar consultas em loop, verificações remotas redundantes, polling excessivo e regeneração desnecessária de todo estado React; medir overhead de qualquer proteção adicionada ao RLS.
- **Integridade:** não alterar saldo, histórico financeiro, treinos, outbox e dados do usuário como efeito colateral do logout.
- **Disponibilidade:** falha transitória de rede não pode transformar sessão legítima em bloqueio definitivo sem possibilidade de recuperação.
- **Manutenibilidade:** componentes GitHub Primer já usados no projeto, hooks coesos, código simples, estados nomeados, responsabilidades isoladas, testes próximos às unidades alteradas. Não adicionar CSS ad hoc ou bibliotecas desnecessárias.
- **Banco:** migrations aditivas/reversíveis e versionadas; preservar policies legítimas, permissões por conta, workers, webhooks e rotas públicas. Não editar uma migration já aplicada como substituto de uma migration nova.
- **Deploy:** não executar migração ou deploy em produção automaticamente. Fornecer plano de rollout, observabilidade, métricas de falha e plano de rollback; solicitar aprovação antes da publicação.

## Entregáveis obrigatórios

1. **Diagnóstico antes/depois**, com arquivos e linhas exatas, causa-raiz e impacto real versus hipótese.
2. **Código corrigido** de frontend, serviços, autenticação, offline e SQL/Edge Functions estritamente necessários.
3. **Migrations SQL** com grants/revokes corretos, zero exposição de `auth.sessions` ao cliente e testes de autorização.
4. **Testes automatizados** cobrindo todas as corridas, falhas parciais, JWT revogado, recovery e offline; não aceitar testes que apenas repitam mocks anteriores.
5. **Relatório final** com arquivos alterados, comandos executados, resultados, limitações, custo de performance, riscos residuais e instruções de validação em homologação.
6. **Critérios de aceite demonstrados**, com evidências de que:
   - O logout **local** não encerra outros dispositivos.
   - O logout **global** revoga as outras sessões e encerra a atual sem resultados falsos.
   - Um JWT antigo de sessão revogada **não executa operações sensíveis** antes do prazo de expiração.
   - Outro dispositivo **online** detecta a revogação e exige login novamente; o **offline** respeita o prazo local documentado.
   - Recuperar senha não mantém uma sessão de recovery autenticada quando a tela afirma exigir login.
   - Treinos não sincronizados continuam íntegros e isolados do próximo usuário.
   - Push, rotas públicas, operações legítimas e desempenho não sofrem regressão.

**Execute a implementação e os testes com disciplina: diagnóstico → design restrito → código → teste de regressão → teste real com duas sessões → relatório. Não marcar a issue como resolvida com a mera sequência `scope: 'others'` + `scope: 'local'`.**

## Documentação técnica oficial para conferência

- [Supabase — Signing out](https://supabase.com/docs/guides/auth/signout)
- [Supabase — User sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase — JavaScript signOut](https://supabase.com/docs/reference/javascript/auth-signout)
- [Supabase — Auth advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
