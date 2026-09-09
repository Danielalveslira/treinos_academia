# Treinos

Aplicação web para acompanhar evolução em treinos de academia: exercícios, registros de treino, indicadores e gráficos de evolução.

## Stack

- **Frontend:** React + Vite
- **UI:** [GitHub Primer React](https://primer.style/) — todos os elementos de interface (botões, formulários, listas, diálogos, feedback) usam componentes do Primer; não há biblioteca de estilo concorrente
- **Autenticação:** Firebase Authentication
- **Banco de dados:** Firebase Firestore (plano gratuito)
- **Hospedagem:** Firebase Hosting (compatível com Vercel/Netlify, ajustando o passo de deploy)

Não há backend Node.js dedicado nesta primeira versão: Firebase Authentication + Firestore + Security Rules cobrem todas as necessidades (autorização por usuário, validação de dados, persistência). Um backend só seria adicionado se surgisse lógica que não pudesse ser confiada ao cliente (ex.: operações administrativas).

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

Regra geral: **components/pages não falam com o Firestore diretamente** — sempre passam por um hook, que por sua vez usa um service. Cálculos de indicadores (volume, evolução %, frequência) ficam isolados em `utils/calculations.js`, puros e testáveis.

Componentes próprios em `components/` existem apenas quando o Primer não tem equivalente direto (ex.: `WorkoutForm`, `ExerciseForm`, `RowActionsMenu`, `LoadChart`/`VolumeChart`) — e mesmo esses são compostos internamente com peças do Primer (`Box`, `FormControl`, `Stack`, `ActionMenu`). Erros de leitura do Firestore nunca são escondidos atrás de uma mensagem genérica: `utils/firestoreError.js` loga o erro real no console e, quando a causa é um índice composto ausente, expõe o link de criação direto na tela (ver `components/ErrorState.jsx`).

**Nota sobre a versão do Primer:** `@primer/react` está fixado em `^37.x` (não `^38`). A v38 removeu `Box` e a prop `sx` do pacote principal em favor de CSS Modules — uma mudança de arquitetura grande demais para este estágio do projeto, e a v37 ainda é a versão com toda a documentação e exemplos oficiais do Primer. Não faça upgrade para v38 sem reescrever a camada de layout.

## Modelo de dados (Firestore)

```
users/{userId}                          { role: 'user' | 'superadmin', createdAt, username? }
users/{userId}/exercises/{exerciseId}   { name, muscleGroup, note, active }
users/{userId}/workouts/{workoutId}     { exerciseId, weight, sets, reps, date, note }

usernames/{username}                    { uid, createdAt }
communities/{communityId}               { name, description, imageUrl, isActive, createdBy, createdAt }
communityMembers/{communityId}_{userId} { communityId, userId, joinedAt }
statuses/{statusId}                     { communityId, authorId, authorUsername, type, createdAt, expiresAt, ... }
statuses/{statusId}/votes/{userId}          { optionId, createdAt }        (type: poll)
statuses/{statusId}/participants/{userId}   { joinedAt }                  (type: workout)
```

Estrutura escolhida por ser a mais simples que atende aos requisitos: subcoleções por usuário isolam os dados naturalmente (cada leitura já é escopada ao usuário autenticado) e evitam junções complexas. Não há coleção separada de "grupos musculares" (é um campo simples no exercício) nem relacionamentos adicionais — não são necessários no estágio atual.

`usernames/{username}` reserva o @ de forma única sem precisar de Cloud Function: `usersService.setUsername` lê esse documento dentro de uma transação do Firestore antes de reivindicar um nome — se dois usuários tentarem o mesmo @ ao mesmo tempo, o Firestore garante que só um vence (a transação perdedora relê o estado e é rejeitada). O e-mail nunca é gravado em `statuses` — só o @ (denormalizado, pelo mesmo motivo de custo explicado abaixo), com "Membro" como texto de exibição para quem ainda não escolheu um.

`communityMembers` usa `{communityId}_{userId}` como ID do documento — o mesmo padrão de `statuses/{statusId}/votes/{userId}` (ID = uid) — para impedir naturalmente duplicidade (entrar duas vezes, votar duas vezes) sem precisar de uma query extra para checar antes de escrever.

## Segurança

- **Firestore Security Rules** (`firestore.rules`) exigem `request.auth.uid == userId` para qualquer leitura/escrita em `users/{userId}/**`, e validam o formato dos documentos de `exercises` e `workouts` no servidor — a validação de formulário no frontend é só uma camada de UX, não a de segurança.
- Nenhuma credencial sensível (service account, chave privada) é usada neste projeto: apenas a configuração pública do Firebase, que é segura para o frontend por design.
- `.env` nunca é versionado (`.gitignore`); use `.env.example` como referência.
- Comunidades seguem o mesmo princípio: criar/editar/excluir comunidade exige `role == "superadmin"` checado nas regras (via `get()` no documento do próprio usuário), nunca só no frontend; publicar em uma comunidade exige filiação (`communityMembers`) e comunidade ativa; editar/excluir publicação exige ser o autor (ou superadmin, para excluir); votos e participações checam se a publicação ainda não expirou.

## Cálculos

```
Volume = peso × séries × repetições
Evolução (%) = ((carga atual - carga anterior) / carga anterior) × 100
```

Casos sem histórico anterior ou carga anterior igual a zero retornam `null` (exibido como "—"), evitando divisão por zero.

## Uso consciente do plano gratuito

- Sem listeners em tempo real (`onSnapshot`) — todas as leituras são pontuais (`getDocs`), sob demanda.
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
2. Ative **Authentication** (método E-mail/senha) e **Firestore Database** (modo produção).
3. Copie `.env.example` para `.env` e preencha com as chaves do seu app web (Configurações do projeto → Seus apps).
4. Instale as dependências e rode em desenvolvimento:

```bash
npm install
npm run dev
```

5. Publique as regras de segurança e os índices (requer [firebase-tools](https://firebase.google.com/docs/cli), via `npx`):

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project <seu-projeto>
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
npx firebase deploy --only hosting,firestore:rules,firestore:indexes
```

**Vercel/Netlify:** build command `npm run build`, output directory `dist`, e configure as mesmas variáveis de `.env.example` no painel do serviço.

## Comunidades

Feed temporário por comunidade, com dois papéis:

- **superadmin**: cria, edita, ativa/desativa e exclui comunidades, e vê quantos membros cada uma tem. Definido pelo campo `role` em `users/{userId}` — só pode ser alterado manualmente no console do Firebase (Firestore → `users/{uid}` → editar `role` para `"superadmin"`) ou via Admin SDK; **nunca** por uma escrita vinda do app (`firestore.rules` bloqueia isso: `create` exige `role == "user"`, `update` exige que o campo não mude). Não existe fluxo de autopromoção de propósito.
- **usuário**: entra/sai de comunidades ativas, publica conteúdo nas que participa, vota em enquetes, confirma presença em treinos marcados.

Cada publicação (`status`) expira 24h após criada (`expiresAt = createdAt + 24h`, validado nas regras com tolerância de alguns minutos para a diferença entre o relógio do cliente — que calcula `expiresAt` — e o `request.time` do servidor, que resolve `createdAt`). O feed sempre filtra `expiresAt > agora`; nada expirado aparece na tela mesmo que o documento ainda exista no banco (a limpeza física é responsabilidade de uma [política de TTL do Firestore](https://firebase.google.com/docs/firestore/ttl) configurada manualmente no console/CLI para o campo `expiresAt` das coleções `statuses` — não há como declarar isso em `firestore.rules`/`firestore.indexes.json`).

Publicações são de três tipos — texto, enquete e treino marcado. Não há upload de foto: o Firebase Storage passou a exigir o plano pago (Blaze) para ser ativado, e usar outro provedor (ex.: Supabase) exigiria uma ponte de autenticação com Cloud Functions (backend que este projeto propositalmente não tem) ou um bucket público sem checagem de usuário — nenhuma das duas opções valeria a pena só para fotos num MVP. Se decidir ativar mais tarde, o Storage cobre isso normalmente dentro da cota gratuita do Blaze.

A quantidade de membros por comunidade (visível só para o superadmin) usa `getCountFromServer` — não lê os documentos de `communityMembers`, só agrega no servidor.

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
