# Autenticação Evolutus — continuação local de P4 (19/11/2026)

> **Superado por `AUTH_RESTRUCTURING_FINAL_TECHNICAL_REPORT.md`**: o "gate ainda pendente" descrito abaixo (legado incompleto vs. `auth_setup`) foi resolvido numa continuação posterior -- o harness `verify-auth-session-isolation.mjs` agora cobre essa sequência inteira (seção "legado incompleto", 6 verificações, JWT real) e `workoutSession.interactions.test.js` não trava mais (20/20). Mantido aqui só como registro histórico do raciocínio e do achado original de `setPasswordAfterConfirmation`.

## Falha encontrada e correção

Na confirmação avulsa de e-mail, `setPasswordAfterConfirmation()` alterava a senha e tratava falhas de `signOut({ scope: 'others' })` e da saída local como sucesso. A página então mandava a pessoa para o login com mensagem de senha redefinida, mesmo sem revogação confirmada. Esse comportamento não atendia ao gate de revogação do prompt.

`ConfirmEmail.jsx` agora conclui três etapas em ordem: `updatePassword`, `revokeOtherSessionsRequired` e `logoutUser`. Guarda em memória quais etapas terminaram; se a revogação falhar, permanece na tela, informa que a senha já mudou e permite retentar sem repetir `updateUser`. Se a saída local falhar, retenta apenas a saída. A antiga função de serviço que engolia erros e seu helper sem outros consumidores foram removidos. `ResetPassword.jsx` e `ConfirmEmail.jsx` distinguem `logoutUser()` com `revoked: false` de uma saída confirmada; `Login.jsx` mostra orientação específica para encerrar todas as sessões após novo login, sem afirmar revogação já concluída.

A retentativa idempotente vale enquanto esta aba permanecer aberta. Recarregar ou fechar a aba apaga o estado em memória; nesse caso a pessoa precisa iniciar uma nova prova de identidade ou recuperação. A senha nunca é persistida localmente para retomar o fluxo.

O teste de componente em `ConfirmEmail.test.js` reproduz a falha da revogação, verifica que não há navegação prematura e que a retentativa não troca a senha novamente. Outro caso garante que `revoked: false` não anuncia sucesso. Os testes antigos que exigiam sucesso apesar da falha foram removidos. Os testes direcionados passaram: 34/34 em `ConfirmEmail.test.js` + `authRecoveryFlow.test.js`; `useRecoveryTokenExchange.test.js` também passou. `npm run lint`: 0 erros, 16 avisos já existentes. `npm run build` e `npm run budget` passaram. `git diff --check` passou.

A suíte completa `npm test` avançou até `src/components/workoutSession.interactions.test.js` e ficou sem saída por 86 segundos nesse arquivo; foi interrompida (`exit 130`). Reproduzi o travamento executando esse arquivo isoladamente com limite de 35 segundos (`exit 124`). Os testes seguintes não foram executados nesta rodada. O arquivo travado é de treinos e não foi alterado nesta continuação; a causa da pendência ainda requer investigação. O resultado anterior documentado de 2784/2784 é de outra sessão e não substitui um gate atual completo.

## Gate ainda pendente

Há um problema de compatibilidade a resolver antes de ativar o hook de Auth e publicar P1: `is_full_login_session()` exige marcador de onboarding concluído, enquanto `ProtectedRoute` mostra “Acesso indisponível” antes de `ProfileCompletionGate` para perfil sem username com termos já aceitos. Mesmo corrigindo a ordem visual, a role `auth_setup` do hook não recebe as permissões das RPCs legadas de conclusão de perfil. Conceder acesso amplo à role ou marcar automaticamente toda sessão de senha como concluída poderia reabrir o cenário de pré-cadastro por terceiro: a pessoa que conhece a senha antiga poderia terminar o perfil após a vítima confirmar o e-mail. É necessário desenhar e testar um caminho estreito, com nova prova de controle do e-mail e comprovação no servidor, para concluir contas legadas incompletas sem abrir essas RPCs para sessões de recuperação. Não habilitar o hook nem declarar o rollout pronto até esse gate passar com JWT real.

O código continua na branch `feat/advertiser-portal-ux`, misturado a alterações locais de publicidade. Nenhum commit, push, PR, migração remota ou deploy foi feito nesta continuação.
