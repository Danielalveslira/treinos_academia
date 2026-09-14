# Treinos

Aplicação web para acompanhar evolução em treinos de academia: exercícios, registros de treino, indicadores e gráficos de evolução.

## Stack

- **Frontend:** React + Vite
- **UI:** [GitHub Primer React](https://primer.style/) — todos os elementos de interface (botões, formulários, listas, diálogos, feedback) usam componentes do Primer; não há biblioteca de estilo concorrente
- **Autenticação:** Firebase Authentication
- **Banco de dados:** Firebase Firestore
- **Backend:** Cloud Functions (`functions/`, Node) — moderação, exclusão de conta/comunidade (jobs em lote), publicação de documentos legais e manutenção de contadores denormalizados. Só existe onde a lógica não pode ser confiada ao cliente (ex.: aplicar uma penalidade); tudo que Firestore Security Rules conseguem validar sozinhas continua sem passar por uma function.
- **Arquivos:** Firebase Storage — hoje só fotos de publicações de comunidade (`statusPhotos/{communityId}/{statusId}.webp`), com regras próprias em `storage.rules`.
- **Hospedagem:** Firebase Hosting (compatível com Vercel/Netlify, ajustando o passo de deploy)

## Arquitetura

```
src/
  components/   componentes visuais reutilizáveis (forms, cards, dialogs)
  pages/        telas da aplicação (uma por rota)
  hooks/        acesso a dados + estado (useAuth, useWorkouts...)
  contexts/     estado compartilhado (AuthContext, ExercisesContext — cache de exercícios)
  services/     acesso direto ao Firebase (Auth e Firestore), sem lógica de UI
  utils/        cálculos puros (volume, evolução %) e validações
  constants/    valores fixos (grupos musculares)
  contexts/     AuthContext (estado de sessão)
  firebase/     inicialização e configuração do SDK
```

Regra geral: **components/pages não falam com o Firestore/Storage diretamente** — sempre passam por um service (`src/services/`), que é quem importa `firebase/config`. Um hook (`src/hooks/`) entra no meio quando há estado para gerenciar (loading, paginação, cache, listener) — para uma chamada pontual sem estado próprio (ex.: um botão de "salvar" chamando `updateUserProfile`), a página chama o service diretamente. Cálculos de indicadores (volume, evolução %, frequência) ficam isolados em `utils/calculations.js`, puros e testáveis.

Componentes próprios em `components/` existem apenas quando o Primer não tem equivalente direto (ex.: `WorkoutForm`, `ExerciseForm`, `RowActionsMenu`, `LoadChart`/`VolumeChart`) — e mesmo esses são compostos internamente com peças do Primer (`Box`, `FormControl`, `Stack`, `ActionMenu`). Erros de leitura do Firestore nunca são escondidos atrás de uma mensagem genérica: `utils/firestoreError.js` loga o erro real no console e, quando a causa é um índice composto ausente, expõe o link de criação direto na tela (ver `components/ErrorState.jsx`).

**Nota sobre a versão do Primer:** `@primer/react` está fixado em `^37.x` (não `^38`). A v38 removeu `Box` e a prop `sx` do pacote principal em favor de CSS Modules — uma mudança de arquitetura grande demais para este estágio do projeto, e a v37 ainda é a versão com toda a documentação e exemplos oficiais do Primer. Não faça upgrade para v38 sem reescrever a camada de layout.

## Modelo de dados (Firestore)

```
users/{userId}                          { role: 'user' | 'superadmin', createdAt, username?, bio?,
                                           shareStatistics?, sexo?, dataNascimento?, heightCm?,
                                           accountStatus? }
users/{userId}/exercises/{exerciseId}   { name, muscleGroup, note, active, order? }
users/{userId}/workouts/{workoutId}     { exerciseId, setDetails | (weight, sets, reps), date, note,
                                           type: 'strength' | 'cardio', createdAt }
users/{userId}/bodyMeasurements/{id}    { date, weightKg?, bodyFatPercent?, waistCm?, hipCm?,
                                           leanMassKg?, note?, createdAt }  (time series — cada
                                           check-in é um documento novo, nunca sobrescreve o anterior)
users/{userId}/legalAcceptances/{version} { userId, version, digest, acceptedAt }
users/{userId}/notices/{noticeId}       aviso de uma restrição/decisão de moderação aplicada à conta

usernames/{username}                    { uid, createdAt }
publicProfiles/{userId}                 { username, bio, shareStatistics }
publicProfiles/{userId}/statistics/summary  { entries, sets, updatedAt } — só existe com
                                           shareStatistics == true; calculado e gravado por uma
                                           Cloud Function (refreshPublicStatistics), nunca pelo
                                           cliente diretamente

communities/{communityId}               { name, description, imageUrl?, isActive, createdBy,
                                           createdAt, postAccess?, memberCount?, iconName? }
communityMembers/{communityId}_{userId} { communityId, userId, joinedAt }
communityRestrictions/{communityId}_{userId}  restrição aplicada a um usuário numa comunidade
statuses/{statusId}                     { communityId, authorId, authorUsername, authorIsSuperAdmin,
                                           type: 'text' | 'poll' | 'workout' | 'achievement' | 'photo',
                                           createdAt, expiresAt, ... }  — expira em 24h, imutável
                                           depois de criado (só create/delete, nunca update)
statuses/{statusId}/votes/{userId}          { optionId, createdAt }        (type: poll)
statuses/{statusId}/participants/{userId}   { joinedAt }                  (type: workout)

sponsoredAds/{adId}                     anúncio de parceiro, alvo por comunidade e/ou global (Home)
accountRestrictions/{userId}            restrição ativa na conta inteira (suspensão/banimento)
rateLimitCounters/{userId}              janela deslizante de publicações recentes (anti-spam)

supportRequests/{requestId}             pedido de atendimento — denúncia, recurso ou privacidade/
                                           exclusão; guarda um contentSnapshot da publicação
                                           denunciada e, se for uma foto, evidencePath (cópia do
                                           arquivo preservada fora do ciclo de vida da publicação)
moderationDecisions/{decisionId}        decisão de moderação (manual ou automática) e sua justificativa
deletionJobs/{kind}_{id}                fila de exclusão em lote (conta/comunidade/publicação) —
                                           processada por uma Cloud Function agendada
legalPolicy/current, legalVersions/{version}  versão vigente dos documentos legais (Termos,
                                           Regras da Comunidade, Política de Privacidade) e seu
                                           histórico publicado
```

Estrutura escolhida por ser a mais simples que atende aos requisitos: subcoleções por usuário isolam os dados naturalmente (cada leitura já é escopada ao usuário autenticado) e evitam junções complexas. Não há coleção separada de "grupos musculares" (é um campo simples no exercício) nem relacionamentos adicionais — não são necessários no estágio atual.

`usernames/{username}` reserva o @ de forma única sem precisar de Cloud Function: `usersService.setUsername` lê esse documento dentro de uma transação do Firestore antes de reivindicar um nome — se dois usuários tentarem o mesmo @ ao mesmo tempo, o Firestore garante que só um vence (a transação perdedora relê o estado e é rejeitada). O e-mail nunca é gravado em `statuses` — só o @ (denormalizado, pelo mesmo motivo de custo explicado abaixo), com "Membro" como texto de exibição para quem ainda não escolheu um.

`communityMembers` usa `{communityId}_{userId}` como ID do documento — o mesmo padrão de `statuses/{statusId}/votes/{userId}` (ID = uid) — para impedir naturalmente duplicidade (entrar duas vezes, votar duas vezes) sem precisar de uma query extra para checar antes de escrever.

## Segurança

- **Firestore Security Rules** (`firestore.rules`) exigem `request.auth.uid == userId` para qualquer leitura/escrita em `users/{userId}/**`, e validam o formato dos documentos de `exercises`, `workouts` e `bodyMeasurements` no servidor — a validação de formulário no frontend é só uma camada de UX, não a de segurança. Cada schema usa `keys().hasOnly([...])` para rejeitar campos fora do esperado, não só validar o formato dos campos previstos.
- Nenhuma credencial sensível (service account, chave privada) é usada no frontend: apenas a configuração pública do Firebase, que é segura para o cliente por design. Cloud Functions (Admin SDK) usam as credenciais padrão do ambiente do Google Cloud, nunca uma chave versionada no repositório.
- **App Check** (reCAPTCHA v3) é opcional em desenvolvimento mas esperado em produção — `scripts/check-production-config.mjs` roda antes de todo `firebase deploy --only hosting` (`firebase.json`, `hosting.predeploy`) e falha o deploy se `VITE_RECAPTCHA_SITE_KEY` não estiver configurada, com um escape hatch explícito (`SKIP_APPCHECK_CHECK=true`) para quem precisa publicar sem ela deliberadamente.
- `.env` nunca é versionado (`.gitignore`); use `.env.example` como referência.
- Comunidades seguem o mesmo princípio: criar/editar/excluir comunidade exige `role == "superadmin"` checado nas regras (via `get()` no documento do próprio usuário), nunca só no frontend; publicar em uma comunidade exige filiação (`communityMembers`) e comunidade ativa; votos exigem que a opção escolhida exista de fato na enquete. Uma publicação (`status`) é imutável depois de criada — as regras só permitem `create` e `delete` (pelo autor ou superadmin), nunca `update`, nem pelo próprio autor.
- Operações que exigem uma transação atômica entre vários documentos onde as regras não bastam (ex.: trocar de @ mexendo em `usernames/`, `users/` e `publicProfiles/` ao mesmo tempo; calcular estatísticas públicas a partir do diário de treino real) passam por uma Cloud Function com Admin SDK, não por um `writeBatch` do cliente — ver `functions/index.js` (`renameUsername`, `refreshPublicStatistics`).
- Ver [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) para o retrato das pendências de segurança conhecidas e aceitas conscientemente (o que ficou em aberto e por quê), mantido como referência única para revisão pós-lançamento.

## Cálculos

```
Volume = peso × séries × repetições
Evolução (%) = ((carga atual - carga anterior) / carga anterior) × 100
```

Casos sem histórico anterior ou carga anterior igual a zero retornam `null` (exibido como "—"), evitando divisão por zero.

## Uso consciente do plano gratuito

- A maioria das leituras é pontual (`getDocs`), sob demanda; a única exceção é o perfil do usuário autenticado (`users/{uid}`), que usa um listener (`onSnapshot`) para refletir na hora ações administrativas feitas em outra sessão (desativar conta, aplicar restrição) — ver `AuthContext.jsx`.
- Histórico paginado (20 registros por página, com "carregar mais").
- Indicadores de exercício limitam a leitura às últimas 30 sessões daquele exercício.
- Dashboard usa uma janela de 50 treinos recentes para volume/frequência e `getCountFromServer` (contagem agregada, custo mínimo) para o total de treinos — evita ler o histórico inteiro.
- Feed de comunidade limitado a 30 publicações não expiradas por consulta; contagem de membros via `getCountFromServer` (não lê os documentos); nome do autor é gravado no próprio `status` (denormalizado) para o feed não precisar de 1 leitura extra em `users` por publicação exibida.

## Performance

- Cada página é carregada sob demanda (`React.lazy` em `App.jsx`) — quem abre a tela de login não baixa o código do dashboard, dos gráficos ou do Firestore.
- `vite.config.js` separa `firebase`, `@primer/react`+`styled-components` e `recharts` em chunks próprios, para o navegador cachear esse código entre deploys (ele só muda quando a dependência muda, não a cada alteração no app).
- Formatação padronizada com Prettier (`npm run format` / `npm run format:check`) — sem isso não há garantia de indentação consistente conforme o projeto cresce.

## Configuração

1. Crie um projeto no [console do Firebase](https://console.firebase.google.com/).
2. Ative **Authentication** (método E-mail/senha), **Firestore Database** (modo produção), **Storage** e **Cloud Functions** (as duas últimas exigem o plano Blaze).
3. Copie `.env.example` para `.env` e preencha com as chaves do seu app web (Configurações do projeto → Seus apps).
4. Instale as dependências e rode em desenvolvimento:

```bash
npm install
npm run dev
```

5. Publique as regras de segurança, os índices, as Cloud Functions e as regras de Storage (requer [firebase-tools](https://firebase.google.com/docs/cli), via `npx`, e o plano Blaze do projeto para Functions/Storage):

```bash
npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions --project <seu-projeto>
```

6. Para usar a área de Comunidades, promova seu próprio usuário a superadmin: no console do Firebase, Firestore → coleção `users` → documento com o seu `uid` → edite o campo `role` para `superadmin`. Sem isso, o link de administração não aparece e `/admin/comunidades` redireciona de volta.

### Testando localmente com os emuladores (opcional)

Sem custo e sem afetar dados reais:

```bash
npm run emulators          # sobe Auth + Firestore emulados
```

Em outro terminal, defina `VITE_USE_FIREBASE_EMULATOR=true` no `.env` e rode `npm run dev`.

## Deploy

**Firebase Hosting:**

```bash
npm run build
npx firebase deploy --only hosting,firestore:rules,firestore:indexes,storage,functions
```

**Vercel/Netlify:** build command `npm run build`, output directory `dist`, e configure as mesmas variáveis de `.env.example` no painel do serviço.

## Comunidades

Feed temporário por comunidade, com dois papéis:

- **superadmin**: cria, edita, ativa/desativa e exclui comunidades, e vê quantos membros cada uma tem. Definido pelo campo `role` em `users/{userId}` — só pode ser alterado manualmente no console do Firebase (Firestore → `users/{uid}` → editar `role` para `"superadmin"`) ou via Admin SDK; **nunca** por uma escrita vinda do app (`firestore.rules` bloqueia isso: `create` exige `role == "user"`, `update` exige que o campo não mude). Não existe fluxo de autopromoção de propósito.
- **usuário**: entra/sai de comunidades ativas, publica conteúdo nas que participa, vota em enquetes, confirma presença em treinos marcados.

Cada publicação (`status`) expira 24h após criada (`expiresAt = createdAt + 24h`, validado nas regras com tolerância de alguns minutos para a diferença entre o relógio do cliente — que calcula `expiresAt` — e o `request.time` do servidor, que resolve `createdAt`). O feed sempre filtra `expiresAt > agora`; nada expirado aparece na tela mesmo que o documento ainda exista no banco (a limpeza física é responsabilidade de uma [política de TTL do Firestore](https://firebase.google.com/docs/firestore/ttl) configurada manualmente no console/CLI para o campo `expiresAt` das coleções `statuses` — não há como declarar isso em `firestore.rules`/`firestore.indexes.json`).

Publicações são de cinco tipos — texto, enquete, treino marcado, conquista do dia (compartilhada a partir do Dashboard, ver "Perfis públicos e conquistas" abaixo) e foto. Fotos vão para o Firebase Storage (`statusPhotos/{communityId}/{statusId}.webp`, um arquivo por publicação, nunca sobrescrito). O documento da foto é criado primeiro e passa por todas as regras do Firestore; só então `storage.rules` aceita os bytes vinculados a esse documento. Na leitura, o Storage confere o status e a filiação à comunidade. Esse encadeamento mantém cada operação dentro do limite de duas consultas cruzadas imposto pelo Storage. A limpeza do arquivo ao excluir a publicação (ou a conta/comunidade inteira) é feita pelo backend (`functions/deletion-service.js`), nunca pelo cliente. O documento de status em si é imutável depois de criado — as regras só permitem `create` e `delete`, nunca `update` (evita reescrever o conteúdo, ou o autor, de uma publicação já vista/votada).

A quantidade de membros por comunidade (visível só para o superadmin) usa `getCountFromServer` — não lê os documentos de `communityMembers`, só agrega no servidor.

## Moderação, atendimento e exclusão de dados

Denúncias, recursos e pedidos de privacidade/exclusão passam por `supportRequests/{id}`, sempre criado por uma Cloud Function (`submitSupportRequest`) — nunca escrito direto pelo cliente. Denunciar uma publicação guarda um retrato do conteúdo (`contentSnapshot`) no momento da denúncia; se for uma foto, a function também copia o arquivo para `moderationEvidence/{requestId}.webp` no Storage, fora do ciclo de vida da publicação original — a evidência sobrevive à expiração/exclusão da publicação (leitura restrita a `superadmin`). Decisões (`decideSupportRequest`) ficam em `moderationDecisions/{id}` e, quando aplicam uma penalidade, também gravam um aviso em `users/{uid}/notices/{id}` e, se for uma suspensão/banimento, em `accountRestrictions/{uid}` ou `communityRestrictions/{communityId}_{uid}`. Publicar em excesso (mais de 8 publicações em 10 minutos) é detectado por um gatilho (`functions/rate-limit-service.js`) — hoje em modo só-log (`RATE_LIMIT_ENFORCE = false`, ver [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).

Excluir uma conta ou comunidade nunca apaga na hora: o pedido cria um `deletionJobs/{kind}_{id}` (bloqueando a conta/comunidade imediatamente pelas regras) e uma Cloud Function agendada (`processDeletionJobs`) drena a limpeza em lotes — perfil, diário de treino, medidas corporais, aceites/notificações, filiações, restrições, interações e o nome de usuário reservado. `supportRequests` e `moderationDecisions` nunca são apagados por essa limpeza (histórico de moderação permanece, mesmo depois da conta denunciante ou denunciada deixar de existir). Detalhes operacionais (ordem de publicação de uma mudança de contrato, verificação local) ficam em [docs/admin-maintenance.md](docs/admin-maintenance.md).

Os documentos legais (Termos de Uso, Regras da Comunidade, Política de Privacidade — `functions/legal/documents.json`) são versionados: mudar o conteúdo exige subir a versão em `functions/legal/manifest.json`, o que força todo usuário a um novo aceite (`acceptLegalDocuments`) antes de continuar publicando ou treinando. A idade mínima e o consentimento específico para dados de saúde (notas de treino, medidas corporais) também são checados nesse fluxo, nunca só confiando num campo enviado pelo cliente.

## Escopo desta primeira versão

Autenticação (cadastro, login, logout, recuperação de senha), CRUD de exercícios, registro/edição/exclusão de treinos, histórico com filtros por exercício e período, dashboard com indicadores essenciais e gráfico de evolução de carga por exercício, e regras de segurança do Firestore. Funcionalidades adicionais (mais gráficos, exportação, etc.) devem ser avaliadas somente depois que essa base estiver validada em uso real.

## Aplicativo instalável (PWA)

O build gera `dist/sw.js`, o manifesto e os ícones. A instalação funciona em HTTPS
ou localhost; o service worker é registrado apenas no build de produção.

```bash
npm run build
npm run preview
```

Abra o endereço exibido pelo preview. O botão **Instalar app** usa a confirmação
nativa quando o navegador a disponibiliza; caso contrário, apresenta instruções.
No iPhone/iPad, use Safari → Compartilhar → Adicionar à Tela de Início.

O cache contém somente arquivos estáticos da interface. Dados do Firebase e
requisições de autenticação não são armazenados pelo service worker. Sem conexão,
uma tela impede o uso dos formulários; ao reconectar, um formulário já aberto
permanece preenchido. Registrar/sincronizar treinos offline não está implementado.

Novas versões são verificadas ao abrir o app e ao voltar à janela. O aviso permite
adiar a atualização ou confirmar o recarregamento. Caches de versões anteriores
são preservados para as abas abertas continuarem carregando seus arquivos.

Para disponibilizar a instalação aos usuários, publique o build no Firebase
Hosting do projeto. `firebase.json` já define HTTPS via Hosting, rotas da SPA e
cabeçalhos de revalidação do worker/manifesto. A publicação não faz parte do build.
Os ícones podem ser regenerados com `python3 scripts/generate-icons.py`.

### Perfis públicos e conquistas

- `/perfil` edita nome, descrição e visibilidade das estatísticas. As alterações são
  gravadas atomicamente no perfil privado e em `publicProfiles/{uid}`. A reserva de
  nome continua transacional; editar apenas a descrição não consulta nomes.
- O `@` das publicações abre `/comunidades/perfil/{uid}`. Apenas usuários autenticados
  podem consultar esse documento público por ID; ele admite somente `username`, `bio`
  e `shareStatistics`. E-mail, papel administrativo e histórico ficam no documento privado.
- Perfis antigos ganham o documento público no próximo acesso, com estatísticas ocultas.
  Antes disso, o visitante vê um estado de perfil indisponível.
- Ao habilitar estatísticas, o app publica um resumo de registros de exercícios e séries
  via agregação no servidor. O botão **Atualizar estatísticas** atualiza esse retrato;
  a página pública informa a data da atualização. Cada registro representa um exercício,
  não necessariamente um dia ou uma sessão completa de treino.
- Desabilitar a opção exclui o resumo e bloqueia sua leitura nas regras. O histórico de
  exercícios nunca é liberado a visitantes, mesmo quando os totais estão visíveis.
- **Compartilhar conquista do dia**, dentro de uma comunidade, consulta apenas os totais
  do dia local e apresenta uma prévia. A mensagem e esses totais são publicados mediante
  confirmação no botão, por 24 horas. Essa publicação é independente da visibilidade
  do perfil e pode ser excluída pelo autor. Os totais são compartilhados pelo cliente,
  não constituem certificação de resultados esportivos.

Antes de disponibilizar esta versão, publique `firestore.rules` e `firestore.indexes.json`
no mesmo projeto Firebase do app (`firebase deploy --only firestore:rules,firestore:indexes`).
O novo índice `workouts(date, sets)` atende à agregação das conquistas do dia. A versão
anterior das regras não permite criar os documentos públicos.

Validação: `npm test` cobre cálculos e datas das conquistas. Com o emulador Firestore
ativo em `127.0.0.1:8080`, `npm run test:rules` verifica leitura pública, bloqueio de dados
privados, ativação/desativação dos totais, agregação e publicação/exclusão de conquistas.
Os testes usam exclusivamente o projeto local `demo-treinos`.
