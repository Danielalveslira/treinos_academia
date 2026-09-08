# Treinos

Aplicação web para acompanhar evolução em treinos de academia: exercícios, registros de treino, indicadores e gráficos de evolução.

## Stack

- **Frontend:** React + Vite
- **Autenticação:** Firebase Authentication
- **Banco de dados:** Firebase Firestore (plano gratuito)
- **Hospedagem:** Firebase Hosting (compatível com Vercel/Netlify, ajustando o passo de deploy)

Não há backend Node.js dedicado nesta primeira versão: Firebase Authentication + Firestore + Security Rules cobrem todas as necessidades (autorização por usuário, validação de dados, persistência). Um backend só seria adicionado se surgisse lógica que não pudesse ser confiada ao cliente (ex.: operações administrativas).

## Arquitetura

```
src/
  components/   componentes visuais reutilizáveis (forms, cards, dialogs)
  pages/        telas da aplicação (uma por rota)
  hooks/        acesso a dados + estado (useAuth, useExercises, useWorkouts...)
  services/     acesso direto ao Firebase (Auth e Firestore), sem lógica de UI
  utils/        cálculos puros (volume, evolução %) e validações
  constants/    valores fixos (grupos musculares)
  contexts/     AuthContext (estado de sessão)
  firebase/     inicialização e configuração do SDK
```

Regra geral: **components/pages não falam com o Firestore diretamente** — sempre passam por um hook, que por sua vez usa um service. Cálculos de indicadores (volume, evolução %, frequência) ficam isolados em `utils/calculations.js`, puros e testáveis.

## Modelo de dados (Firestore)

```
users/{userId}
users/{userId}/exercises/{exerciseId}   { name, muscleGroup, note, active }
users/{userId}/workouts/{workoutId}     { exerciseId, weight, sets, reps, date, note }
```

Estrutura escolhida por ser a mais simples que atende aos requisitos: subcoleções por usuário isolam os dados naturalmente (cada leitura já é escopada ao usuário autenticado) e evitam junções complexas. Não há coleção separada de "grupos musculares" (é um campo simples no exercício) nem relacionamentos adicionais — não são necessários no estágio atual.

## Segurança

- **Firestore Security Rules** (`firestore.rules`) exigem `request.auth.uid == userId` para qualquer leitura/escrita em `users/{userId}/**`, e validam o formato dos documentos de `exercises` e `workouts` no servidor — a validação de formulário no frontend é só uma camada de UX, não a de segurança.
- Nenhuma credencial sensível (service account, chave privada) é usada neste projeto: apenas a configuração pública do Firebase, que é segura para o frontend por design.
- `.env` nunca é versionado (`.gitignore`); use `.env.example` como referência.

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

## Escopo desta primeira versão

Autenticação (cadastro, login, logout, recuperação de senha), CRUD de exercícios, registro/edição/exclusão de treinos, histórico com filtros por exercício e período, dashboard com indicadores essenciais e gráfico de evolução de carga por exercício, e regras de segurança do Firestore. Funcionalidades adicionais (mais gráficos, exportação, etc.) devem ser avaliadas somente depois que essa base estiver validada em uso real.
