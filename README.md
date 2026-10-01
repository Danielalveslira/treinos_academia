# Treinos

Aplicação web para acompanhar evolução em treinos de academia: exercícios, registros de treino, indicadores e gráficos de evolução.

## Stack

- **Frontend:** React + Vite
- **UI:** [GitHub Primer React](https://primer.style/) — todos os elementos de interface (botões, formulários, listas, diálogos, feedback) usam componentes do Primer; não há biblioteca de estilo concorrente
- **Backend:** [Supabase](https://supabase.com/) — Postgres (banco + autenticação + storage), Row Level Security como camada de autorização, RPCs (`supabase/migrations/`) para qualquer escrita que precise de lógica/transação atômica, Edge Functions (`supabase/functions/`) para o que SQL puro não alcança (chamadas HTTP externas, Storage, Auth admin), `pg_cron` para rotinas agendadas (liquidação de recompensas, worker de exclusão de conta).
- **Hospedagem:** Vercel (`vercel.json`)

## Arquitetura

```
src/
  components/   componentes visuais reutilizáveis (forms, cards, dialogs)
  pages/        telas da aplicação (uma por rota)
  hooks/        acesso a dados + estado (useAuth, useWorkouts...)
  contexts/     estado compartilhado (AuthContext, ExercisesContext — cache de exercícios)
  services/     acesso ao Supabase (supabase.from()/.rpc()), sem lógica de UI
  utils/        cálculos puros (volume, evolução %) e validações
  constants/    valores fixos (grupos musculares)
  supabase/     inicialização do client (config.js)

supabase/
  migrations/   todo o schema, RLS, RPCs e triggers — fonte de verdade do backend
  functions/    Edge Functions (Deno) — só onde SQL puro não alcança
```

Regra geral: **components/pages não falam com o Supabase diretamente** — sempre passam por um service (`src/services/`), que é quem importa `supabase/config`. Um hook (`src/hooks/`) entra no meio quando há estado para gerenciar (loading, paginação, cache, listener realtime) — para uma chamada pontual sem estado próprio, a página chama o service diretamente. Cálculos de indicadores (volume, evolução %, frequência) ficam isolados em `utils/calculations.js`, puros e testáveis.

Componentes próprios em `components/` existem apenas quando o Primer não tem equivalente direto (ex.: `WorkoutForm`, `ExerciseForm`, `RowActionsMenu`, `LoadChart`/`VolumeChart`) — e mesmo esses são compostos internamente com peças do Primer (`Box`, `FormControl`, `Stack`, `ActionMenu`). Erros de consulta nunca são escondidos atrás de uma mensagem genérica sem log: `utils/queryError.js` loga o erro real no console e devolve uma mensagem amigável pro usuário (ver `components/ErrorState.jsx`).

**Nota sobre a versão do Primer:** `@primer/react` está fixado em `^37.x` (não `^38`). A v38 removeu `Box` e a prop `sx` do pacote principal em favor de CSS Modules — uma mudança de arquitetura grande demais para este estágio do projeto, e a v37 ainda é a versão com toda a documentação e exemplos oficiais do Primer. Não faça upgrade para v38 sem reescrever a camada de layout.

## Modelo de dados (Postgres/Supabase)

O schema completo — tabelas, constraints, índices, RLS, RPCs e triggers — vive versionado em `supabase/migrations/`, aplicado em ordem (`supabase db push`). Não há um resumo paralelo aqui que possa ficar desatualizado; para entender uma tabela específica, leia a migration que a criou (o nome do arquivo já indica o domínio: `*_workouts.sql`, `*_statuses.sql`, `*_economy_*.sql`, etc.) — cada uma tem comentários explicando as decisões.

Visão geral dos domínios principais: `users`/`exercises`/`workouts`/`body_measurements` (núcleo pessoal), `communities`/`community_members`/`statuses`/`status_votes`/`status_participants` (comunidades e feed), `wallets`/`economy_transactions`/`cash_purchases`/`promotions` (EvoCoins/EvoCash), `support_requests`/`moderation_decisions`/`account_restrictions` (moderação/atendimento), `deletion_jobs` (exclusão de conta/comunidade/publicação, processada por `pg_cron` + a Edge Function `process-deletion-jobs`), `legal_policy`/`legal_versions`/`legal_acceptances` (termos/privacidade versionados), `exercise_catalog` (catálogo próprio de exercícios, `imports/exercicios_ptbr.json`).

## Segurança

- **Row Level Security** (ativado em toda tabela que o cliente lê/escreve diretamente) restringe cada linha ao próprio `auth.uid()`, com exceções explícitas por policy para dado público (perfis públicos, feed de comunidade) — a validação de formulário no frontend é só uma camada de UX, não a de segurança.
- Operações que precisam de lógica/transação além do que uma policy consegue expressar (reservar um @ único, votar sem corrida, processar uma compra) são RPCs `security definer`, nunca um `insert`/`update` direto do cliente — ver os arquivos em `supabase/migrations/`.
- Nenhuma credencial sensível (service role key) é usada no frontend — só a URL pública do projeto e a anon key, que são seguras para o cliente por design (protegidas pela RLS, não por serem secretas). A service role key só existe como secret de Edge Function ou variável de ambiente de script administrativo, nunca no bundle do app.
- `.env` nunca é versionado (`.gitignore`).
- Ver [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) para o retrato das pendências de segurança conhecidas e aceitas conscientemente.

## Cálculos

```
Volume = peso × séries × repetições
Evolução (%) = ((carga atual - carga anterior) / carga anterior) × 100
```

Casos sem histórico anterior ou carga anterior igual a zero retornam `null` (exibido como "—"), evitando divisão por zero.

## Performance

- Cada página é carregada sob demanda (`React.lazy` em `App.jsx`) — quem abre a tela de login não baixa o código do dashboard nem dos gráficos.
- Histórico e catálogo de exercícios são sempre paginados no Postgres — nunca carrega a lista inteira no frontend.
- `vite.config.js` separa `@primer/react`+`styled-components` e `recharts` em chunks próprios, para o navegador cachear esse código entre deploys.
- Formatação padronizada com Prettier (`npm run format` / `npm run format:check`).

## Configuração

1. Crie um projeto no [Supabase](https://supabase.com/dashboard).
2. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (Project Settings → API).
3. Instale as dependências e rode em desenvolvimento:

```bash
npm install
npm run dev
```

4. Aplique o schema no seu projeto (requer a [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
npx supabase link --project-ref <seu-projeto>
npx supabase db push
npx supabase functions deploy
```

5. Para usar a área de Comunidades, promova seu próprio usuário a superadmin: no SQL editor do Supabase, `update public.users set role = 'superadmin' where id = '<seu-uid>';`. Sem isso, o link de administração não aparece e `/admin/comunidades` redireciona de volta.

### Testando localmente (opcional)

```bash
npx supabase start   # sobe Postgres/Auth/Storage local (Docker)
npx supabase db reset
npm run dev           # com um .env.local apontando pro Supabase local
```

## Deploy

**Vercel:** build command `npm run build`, output directory `dist`, configure as mesmas variáveis de `.env.example` no painel do serviço. Mudanças de schema são publicadas separadamente via `npx supabase db push`/`functions deploy`, nunca pelo deploy do frontend.

## Comunidades

Feed temporário por comunidade, com dois papéis:

- **superadmin**: cria, edita, ativa/desativa e exclui comunidades, e vê quantos membros cada uma tem. Definido pelo campo `role` em `public.users` — só alterável diretamente no banco (SQL editor/RPC administrativa), nunca por uma escrita vinda do app. Não existe fluxo de autopromoção de propósito.
- **usuário**: entra/sai de comunidades ativas, publica conteúdo nas que participa, vota em enquetes, confirma presença em treinos marcados.

Cada publicação (`status`) expira 24h após criada. O feed sempre filtra publicações não expiradas; a limpeza física (remover a linha e o arquivo associado) é feita pelo worker de exclusão (`pg_cron` + Edge Function `process-deletion-jobs`), nunca pelo cliente.

Publicações são de cinco tipos — texto, enquete, treino marcado, conquista do dia e foto. Fotos vão para o bucket `status-photos` do Supabase Storage, com RLS própria.

## Moderação, atendimento e exclusão de dados

Denúncias, recursos e pedidos de privacidade/exclusão passam por `public.support_requests`, sempre criado por uma RPC (nunca um insert direto do cliente). Decisões ficam em `public.moderation_decisions` e, quando aplicam uma penalidade, também geram um aviso para o usuário e, se for suspensão/banimento, uma linha em `account_restrictions`/`community_restrictions`.

Excluir uma conta, comunidade ou publicação nunca apaga na hora: o pedido cria uma linha em `public.deletion_jobs` (bloqueando o alvo imediatamente via RLS/status), e a Edge Function `process-deletion-jobs` (chamada por `pg_cron` a cada minuto) processa a fila — apaga os dados do usuário/comunidade/publicação, preservando auditoria financeira (`economy_transactions`) e histórico de moderação (`support_requests`, `moderation_decisions`) independente do destino da conta. Uma conta com compra de EvoCash pendente ou saldo positivo fica represada (`blocked_financial_review`) até revisão administrativa — nunca exclui com saldo real em aberto.

Os documentos legais (Termos de Uso, Regras da Comunidade, Política de Privacidade — `legal/documents.json`) são versionados: mudar o conteúdo exige subir a versão em `legal/manifest.json` e rodar `scripts/seed-legal.mjs`, o que força todo usuário a um novo aceite antes de continuar publicando ou treinando.

## Escopo desta primeira versão

Autenticação (cadastro, login, logout, recuperação de senha), CRUD de exercícios, registro/edição/exclusão de treinos, histórico com filtros por exercício e período, dashboard com indicadores essenciais e gráfico de evolução de carga por exercício, com Row Level Security como camada de autorização. Funcionalidades adicionais devem ser avaliadas somente depois que essa base estiver validada em uso real.

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

O cache contém somente arquivos estáticos da interface. Dados e requisições de
autenticação não são armazenados pelo service worker. Sem conexão, uma tela
impede o uso dos formulários; ao reconectar, um formulário já aberto permanece
preenchido. Registrar/sincronizar treinos offline não está implementado.

Novas versões são verificadas ao abrir o app e ao voltar à janela. O aviso permite
adiar a atualização ou confirmar o recarregamento. Caches de versões anteriores
são preservados para as abas abertas continuarem carregando seus arquivos.

A publicação acontece via Vercel (ver "Deploy" acima); não faz parte do build.
Os ícones podem ser regenerados com `python3 scripts/generate-icons.py`.

### Perfis públicos e conquistas

- `/perfil` edita nome, descrição e visibilidade das estatísticas. As alterações são
  gravadas atomicamente no perfil privado e em `public_profiles`. A reserva de
  nome continua transacional; editar apenas a descrição não consulta nomes.
- O `@` das publicações abre `/comunidades/perfil/{uid}`. `public_profiles` admite
  leitura pública (RLS) e expõe somente `username`, `bio` e `share_statistics`.
  E-mail, papel administrativo e histórico ficam na tabela privada `users`.
- Perfis antigos ganham a linha pública no próximo acesso, com estatísticas ocultas.
  Antes disso, o visitante vê um estado de perfil indisponível.
- Ao habilitar estatísticas, o app publica um resumo de registros de exercícios e séries
  via agregação no servidor (RPC). O botão **Atualizar estatísticas** atualiza esse
  retrato; a página pública informa a data da atualização.
- Desabilitar a opção exclui o resumo e bloqueia sua leitura via RLS. O histórico de
  exercícios nunca é liberado a visitantes, mesmo quando os totais estão visíveis.
- **Compartilhar conquista do dia**, dentro de uma comunidade, consulta apenas os totais
  do dia local e apresenta uma prévia. A mensagem e esses totais são publicados mediante
  confirmação no botão, por 24 horas. Os totais são compartilhados pelo cliente, não
  constituem certificação de resultados esportivos.

Validação: `npm test` cobre cálculos, datas das conquistas e a lógica de serviço (via esbuild, mockando `supabase/config.js`).
