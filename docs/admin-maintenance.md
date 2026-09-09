# Administração: publicação e manutenção

## Mudanças de contrato

- `listAccountsForAdmin({ search, cursor, pageSize })` retorna `{ accounts, nextCursor }`. Página máxima de 50, ordenada por UID; perfis sem `createdAt` continuam visíveis. Busca por início do @usuário, e-mail completo ou UID exato. O UID do retorno é sempre o caminho do documento. E-mails permanecem no Authentication e são obtidos em lote por página.
- `confirmPayment` exige `operationId`. O cliente conserva esse identificador em `sessionStorage` enquanto não receber confirmação. Repetir a mesma operação não renova novamente. Pagamentos distintos, mesmo com usuário e plano iguais, exigem operações distintas. Confirmar não reativa contas desativadas administrativamente.
- Exclusões de contas e comunidades retornam uma solicitação pendente. A conta/comunidade fica bloqueada imediatamente pelas regras; a limpeza continua no servidor.
- `deletionJobs` é privado. O admin acompanha os primeiros 50 trabalhos pendentes pelo painel. O executor roda a cada minuto, seleciona até 10 trabalhos por antiguidade de atualização e limita cada trabalho a um lote não vazio de até 100 documentos. Uma concessão temporária de 120 segundos evita execução concorrente; falhas conservam o progresso e voltam à fila.
- Exclusão de publicação, inclusive por TTL, agenda a remoção de votos/participações. Remoção de comunidade agenda também filiações, restrições e publicações.
- A limpeza de conta preserva `payments`, `supportRequests` e `moderationDecisions`; remove perfil, diário, aceites/notificações, perfil público, nomes reservados, filiações, restrições e interações. Essa lista segue o esquema atual e deve acompanhar novas coleções.
- Trabalhos concluídos de conta permanecem como marcadores para impedir recriação usando tokens antigos. Trabalhos concluídos de publicação/comunidade expiram após sete dias via TTL; a exclusão física pelo TTL não é imediata.

## Ordem de publicação

A versão deve ser publicada em conjunto; clientes antigos não enviam atribuição de usuário em votos/participações nem identificador de pagamento. Recarregar clientes antigos após a publicação.

1. Publicar os índices de `firestore.indexes.json` e aguardar que os novos índices de grupos de coleção (`votes.userId`, `participants.userId`) e de trabalhos/moderação estejam prontos. O arquivo declara também o TTL de `deletionJobs.expireAt`.
2. Publicar `firestore.rules` e as Functions novas, incluindo `processDeletionJobs`, `cleanupDeletedStatus` e `cleanupDeletedCommunity`. O executor agendado exige Cloud Scheduler habilitado e permissões da conta de serviço para administrar usuários no Authentication.
3. Publicar o frontend compatível. Até o fim da migração, a exclusão de contas retorna uma mensagem de preparação pendente. Comunidades e pagamentos continuam disponíveis.
4. Simular e aplicar a migração de interações com credenciais administrativas e projeto explícito:

   ```sh
   node functions/migrate-admin.js --project SEU_PROJETO
   node functions/migrate-admin.js --project SEU_PROJETO --apply
   ```

   Sem `--apply`, o comando apenas lê e informa a quantidade de interações a atualizar e ocorrências de trabalhos de limpeza a criar (um mesmo pai ausente pode aparecer em mais de uma página na simulação). A migração pagina em lotes de 100, atribui `userId` pelo ID imutável do documento e agenda limpeza de subcoleções de publicações já removidas e de referências a comunidades ausentes. Pode ser repetida após falha. Somente uma execução aplicada e concluída grava `maintenance/adminV1.interactionsVersion = 1`, liberando exclusões de contas. Para um projeto novo vazio, executar o mesmo comando aplicado para registrar a preparação.

5. Verificar trabalhos pendentes e logs do executor. Não remover manualmente os marcadores `deletionJobs/account_*`: eles são parte do bloqueio de gravações. Solicitações que falham voltam à fila automaticamente; corrigir a causa registrada em `lastError` antes de aguardar nova execução.

A preparação de dados e a publicação não são executadas automaticamente pelos testes ou pelo build. O agendamento tem invocações e leituras periódicas mesmo quando a fila está vazia; os índices excluídos de campos extensos reduzem armazenamento e trabalho de escrita, mas mantêm os índices usados nas consultas.

## Verificação local

Iniciar o emulador Firestore na porta 8080 e executar:

```sh
npm test
npm --prefix functions test
npm run test:rules
npm run lint
npm run build
```

Os testes de integração usam exclusivamente `demo-admin-rules` e `demo-treinos`. Eles exercitam regras reais e transações no Firestore emulado, com operações de Authentication simuladas para injetar falhas sem acessar contas reais. Triggers e agendamento devem ser verificados após a publicação: no teste local, as etapas de limpeza são executadas diretamente.
