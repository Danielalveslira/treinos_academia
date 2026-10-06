# Evolutus — Plano Completo de Evolução da PWA

## PWA leve, robusta, offline-first e sincronizada com Supabase

**Status:** plano técnico de implementação
**Projeto:** Evolutus / `treinos_academia`
**Backend oficial:** Supabase + PostgreSQL
**Frontend:** React + Vite
**Objetivo:** manter o Evolutus como PWA, melhorar desempenho e experiência em celulares, tablets e desktop, permitir uso de treinos sem internet e sincronizar com o banco oficial assim que a conexão voltar.

> **Importante:** este documento assume a arquitetura atual do Evolutus em Supabase/PostgreSQL. Não reintroduzir Firebase, Firestore, Firebase Auth ou Firebase Storage nas novas implementações. O snapshot de código usado como referência para a auditoria da PWA é anterior a algumas correções recentes; antes de alterar arquivos, revalidar tudo contra a `main` atual.

---

# 1. Resultado esperado

Ao final da implementação, o Evolutus deve funcionar assim:

```text
                         EVOLUTUS
                            │
                      React + Vite
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
    Service Worker                         IndexedDB
    arquivos/cache                        dados locais
          │                                   │
          │                           ┌───────┴────────┐
          │                           │                │
          │                      dados cacheados     outbox
          │                           │                │
          └─────────── App ───────────┴────────────────┘
                                             │
                                      Sync Engine
                                             │
                           ┌─────────────────┴──────────────┐
                           │                                │
                        offline                           online
                           │                                │
                    continua usando              Supabase RPC / API
                                                            │
                                                       PostgreSQL
```

O usuário deverá poder:

- abrir a PWA já instalada mesmo sem internet;
- visualizar o treino atual já preparado no aparelho;
- visualizar o catálogo de exercícios armazenado localmente;
- registrar carga, repetições, observações e séries sem internet;
- concluir exercícios e finalizar o treino offline;
- fechar o app sem perder os registros;
- reabrir o Evolutus e continuar do ponto em que parou;
- sincronizar automaticamente quando uma conexão válida voltar;
- visualizar claramente se os dados estão `salvos no aparelho`, `sincronizando`, `sincronizados` ou em `conflito`;
- continuar usando o app enquanto a sincronização ocorre em segundo plano;
- receber atualizações da PWA sem perder alterações ainda não sincronizadas.

O objetivo **não** é tornar todo o produto offline. Operações financeiras, administrativas e sensíveis continuarão exigindo servidor.

---

# 2. Diagnóstico da PWA atual

A base atual já possui pontos positivos:

- React + Vite;
- `manifest.webmanifest`;
- modo `standalone`;
- ícones PWA e maskable icon;
- Service Worker próprio;
- estratégia de atualização controlada pelo usuário;
- navegação `network-first`;
- assets versionados por hash;
- `React.lazy()` em várias rotas;
- backend Supabase já consolidado no projeto atual.

Porém, a PWA ainda foi construída com a premissa de que **é necessário estar online para usar o produto**.

No snapshot auditado, `PwaControls.jsx` faz o seguinte quando `navigator.onLine === false`:

```text
conexão caiu
    ↓
abre tela cheia "Você está sem conexão"
    ↓
app-content recebe inert
    ↓
usuário não consegue continuar usando o Evolutus
```

Isso precisa ser invertido.

A nova premissa será:

```text
conexão caiu
    ↓
app continua funcionando
    ↓
alterações ficam no banco local
    ↓
status discreto avisa "Salvo neste aparelho"
    ↓
conexão voltou
    ↓
sincronização com Supabase
```

Outro ponto atual é o precache. O plugin PWA existente adiciona praticamente todos os assets gerados pelo build em `ASSETS` e executa `cache.addAll(ASSETS)` na instalação do Service Worker.

Isso funciona, mas tende a ficar mais pesado conforme o produto cresce. A estratégia precisa diferenciar:

- app shell essencial;
- chunks JS/CSS com hash;
- imagens;
- conteúdo carregado sob demanda;
- dados estruturados, que não devem depender do Cache Storage.

---

# 3. Princípios obrigatórios da nova arquitetura

## 3.1 Local-first para treinos

Para ações relacionadas ao treino, a gravação local deve acontecer **antes** da sincronização remota.

Não usar o padrão:

```text
UI → Supabase → sucesso → atualizar UI
```

Usar:

```text
UI → IndexedDB → atualizar UI imediatamente
                  ↓
                 outbox
                  ↓
              Supabase
```

Isso melhora tanto o modo offline quanto a velocidade percebida quando o usuário está online.

## 3.2 Supabase continua sendo a fonte oficial

IndexedDB é uma réplica/cache operacional do dispositivo, não o banco oficial.

O estado persistente oficial continua no PostgreSQL/Supabase.

## 3.3 Segurança sempre no servidor

Nenhuma validação de IndexedDB deve substituir:

- RLS;
- constraints;
- validações SQL;
- permissões de RPC;
- validações de propriedade do registro;
- regras financeiras;
- regras de participação e acesso.

Nunca confiar em `user_id`, timestamps ou valores financeiros enviados pelo cliente sem revalidação no servidor.

## 3.4 Operações críticas continuam online-only

Não enfileirar offline:

- compra de EvoCash;
- PIX;
- transferências financeiras;
- alterações de saldo;
- decisões administrativas;
- concessão de privilégios;
- exclusão de conta;
- ações de moderação críticas;
- mudanças jurídicas/aceite que dependam da versão atual no servidor;
- ações cuja validade dependa do estado atual do banco.

## 3.5 O app nunca deve depender exclusivamente de Background Sync

Background Sync pode ser usado como melhoria progressiva, mas o funcionamento principal deve ocorrer também em navegadores que não possuem essa API.

A sincronização obrigatória acontecerá quando:

- o app abrir;
- a aba voltar a ficar visível;
- a janela recuperar foco;
- o evento `online` ocorrer;
- o usuário concluir uma alteração enquanto houver internet;
- o usuário clicar em `Sincronizar agora`;
- o usuário abrir/fechar o treino;
- opcionalmente, em intervalo moderado enquanto o app estiver visível e houver itens pendentes.

---

# 4. Escopo offline por recurso

## Fase inicial

| Recurso | Offline | Observação |
|---|---:|---|
| Abrir o app | Sim | App shell deve estar disponível |
| Catálogo de exercícios | Sim | IndexedDB |
| Busca de exercícios | Sim | Busca local |
| Treino atual | Sim | Réplica local |
| Séries | Sim | Gravação local + outbox |
| Carga/repetições | Sim | Gravação local + outbox |
| Observações do treino | Sim | Gravação local + outbox |
| Concluir série | Sim | Gravação local + outbox |
| Concluir exercício | Sim | Gravação local + outbox |
| Finalizar treino | Sim | Evento pendente até sincronizar |
| Histórico recente | Sim | Cache local limitado |
| Imagens já acessadas | Sim | Runtime cache |
| Perfil básico | Parcial | Cache somente leitura |
| Comunidades | Online inicialmente | Offline depois, se houver necessidade |
| Comentários | Online inicialmente | Evitar complexidade na primeira versão |
| Vitrine | Online inicialmente | Cache de leitura pode vir depois |
| EvoCash | Não | Online-only |
| PIX | Não | Online-only |
| Financeiro | Não | Online-only |
| Administração | Não | Online-only |
| Exclusão de conta | Não | Online-only |

A primeira entrega deve resolver muito bem **treino + exercícios + histórico recente** antes de expandir o escopo.

---

# 5. Estrutura sugerida no frontend

Criar uma camada explícita de persistência e sincronização.

```text
src/
├─ offline/
│  ├─ db/
│  │  ├─ openDatabase.js
│  │  ├─ schema.js
│  │  ├─ migrations.js
│  │  └─ repositories/
│  │     ├─ workoutsLocalRepository.js
│  │     ├─ exercisesLocalRepository.js
│  │     ├─ historyLocalRepository.js
│  │     └─ outboxRepository.js
│  │
│  ├─ sync/
│  │  ├─ syncEngine.js
│  │  ├─ syncScheduler.js
│  │  ├─ syncLock.js
│  │  ├─ mutationCompactor.js
│  │  ├─ conflictResolver.js
│  │  └─ syncTelemetry.js
│  │
│  ├─ connectivity/
│  │  ├─ connectivityService.js
│  │  └─ useConnectivity.js
│  │
│  └─ storage/
│     ├─ persistence.js
│     └─ storageQuota.js
│
├─ services/
│  ├─ workoutService.js
│  ├─ exerciseCatalogService.js
│  └─ ...
│
├─ hooks/
│  ├─ useSyncStatus.js
│  ├─ usePendingMutations.js
│  └─ useOnlineStatus.js
│
└─ components/
   ├─ SyncStatus.jsx
   ├─ OfflineBanner.jsx
   └─ PwaControls.jsx
```

Evitar espalhar chamadas diretas de IndexedDB por componentes React. Componentes chamam serviços/repositories; somente a camada offline conhece detalhes do banco local.

---

# 6. IndexedDB: banco local do Evolutus

## 6.1 Escolha

Usar IndexedDB, não `localStorage`, para dados de treino.

`localStorage` deve continuar apenas para preferências muito pequenas e não críticas.

Para facilitar o código e reduzir bugs de transação, pode ser usado um wrapper pequeno como `idb`. Evitar bibliotecas grandes se o mesmo resultado puder ser obtido com uma dependência pequena.

## 6.2 Nome e versionamento

Sugestão:

```text
evolutus-local-v1
```

O número da versão deve ser controlado pelas migrations do IndexedDB, e não pelo hash do build.

## 6.3 Stores iniciais

```text
workouts
workoutExercises
workoutSets
exerciseCatalog
recentHistory
profileCache
outbox
syncMeta
```

### `workouts`

Campos mínimos:

```text
id
user_id
workout_plan_id
started_at
finished_at
status
notes
device_updated_at
server_updated_at
server_version
sync_status
```

### `workoutSets`

```text
id
user_id
workout_id
exercise_id
set_number
weight
repetitions
completed_at
notes
device_updated_at
server_updated_at
server_version
sync_status
```

### `exerciseCatalog`

Pode manter localmente os 868 exercícios válidos do catálogo próprio do Evolutus.

Armazenar somente metadados necessários para uso offline. Imagens devem permanecer no Cache Storage/runtime cache, não duplicadas como Blob no IndexedDB sem necessidade.

### `outbox`

```text
mutation_id
user_id
aggregate_type
aggregate_id
entity_type
entity_id
operation
payload
base_version
sequence
created_at
attempt_count
next_attempt_at
last_error
status
```

Estados possíveis:

```text
pending
syncing
synced
conflict
failed
```

Itens `synced` podem ser removidos após ACK; não há necessidade de manter a outbox indefinidamente.

### `syncMeta`

```text
key
value
```

Exemplos:

```text
last_successful_sync
catalog_version
history_cursor
schema_version
```

---

# 7. IDs devem nascer no cliente

Entidades que podem ser criadas offline precisam receber o ID antes de existir no servidor.

Usar:

```js
crypto.randomUUID()
```

Não depender de IDs gerados somente pelo banco para entidades offline.

Exemplo:

```text
usuário conclui uma série
       ↓
cliente cria UUID
       ↓
IndexedDB salva imediatamente
       ↓
outbox usa o mesmo UUID
       ↓
Supabase recebe posteriormente
```

Isso elimina a necessidade de substituir IDs locais temporários depois da sincronização.

---

# 8. Outbox: coração da sincronização

Toda alteração offline sincronizável deve gerar uma mutação de domínio.

Não armazenar requisições HTTP completas, headers ou tokens.

Evitar:

```json
{
  "url": "/rest/v1/workout_sets",
  "headers": {
    "Authorization": "Bearer ..."
  },
  "body": {}
}
```

Preferir:

```json
{
  "mutation_id": "uuid",
  "operation": "workout_set.upsert",
  "entity_id": "uuid",
  "aggregate_id": "workout-uuid",
  "base_version": 3,
  "payload": {
    "exercise_id": "...",
    "set_number": 2,
    "weight": 80,
    "repetitions": 10
  }
}
```

A sessão/autorização utilizada para sincronizar será sempre a sessão Supabase atual no momento do envio.

---

# 9. Operações permitidas inicialmente

Não criar uma RPC que aceite nomes de tabelas ou SQL arbitrário.

Criar uma lista fechada de operações.

Exemplo:

```text
workout.create
workout.update
workout.finish
workout_exercise.upsert
workout_set.upsert
workout_set.delete
```

Posteriormente podem ser adicionadas outras operações mediante migration e validação.

---

# 10. Ordenação de mutações

A outbox deve respeitar dependências.

Exemplo:

```text
1. workout.create
2. workout_exercise.upsert
3. workout_set.upsert
4. workout_set.upsert
5. workout.finish
```

Cada mutação pode possuir `sequence` dentro do agregado `workout_id`.

O Sync Engine não deve enviar `workout.finish` antes das alterações anteriores daquele treino.

---

# 11. Compactação da fila

Quando o usuário altera repetidamente o mesmo dado antes da sincronização, não é necessário enviar todos os estados intermediários.

Exemplo:

```text
80 kg → 82 kg → 84 kg
```

Se as três alterações ainda estiverem pendentes, compactar para:

```text
84 kg
```

Regras:

- nunca compactar operações que tenham significado histórico próprio;
- `create + update + update` pode virar um único `create` com estado final;
- `update + update` pode virar o último `update`;
- `create + delete` ainda não enviado pode desaparecer completamente;
- não compactar após uma mutação já ter sido reconhecida pelo servidor.

Isso reduz chamadas e escritas no banco.

---

# 12. Fluxo de gravação local

Exemplo de conclusão de série:

```text
Usuário toca "Concluir série"
        │
        ▼
validar campos no cliente
        │
        ▼
abrir transação IndexedDB
        │
        ├─ atualizar workoutSet
        │
        └─ inserir mutação na outbox
        │
        ▼
commit local
        │
        ▼
UI mostra imediatamente a série concluída
        │
        ▼
se houver conexão → solicitar sync
```

A gravação do registro local e da mutação correspondente deve ocorrer na mesma transação IndexedDB sempre que possível.

Assim não existe situação onde o dado local foi alterado mas a mutação desapareceu.

---

# 13. Sync Engine

Criar `syncEngine.js` como serviço independente da UI.

Fluxo:

```text
requestSync()
   │
   ├─ há usuário autenticado?
   ├─ há mutações pendentes?
   ├─ outro sync já está ativo?
   └─ conexão parece disponível?
           │
           ▼
      adquirir Web Lock
           │
           ▼
      compactar fila
           │
           ▼
      carregar lote
           │
           ▼
      chamar RPC Supabase
           │
      ┌────┴───────────┐
      │                │
    sucesso           erro
      │                │
    ACK                ├─ rede → manter pending
      │                ├─ auth → parar e renovar sessão
      │                ├─ conflito → conflict
      │                └─ validação → failed
      ▼
remover/confirmar
      │
      ▼
próximo lote
```

## Lotes

Começar conservadoramente com algo como 25–50 mutações por lote.

Não enviar filas gigantes em uma única chamada.

## Retry

Implementar exponential backoff com jitter.

Exemplo conceitual:

```text
1ª tentativa → agora
2ª → ~2 s
3ª → ~5 s
4ª → ~15 s
5ª → ~30 s
...
```

Não fazer loops agressivos.

Erros permanentes de validação não devem ficar tentando indefinidamente.

---

# 14. Web Locks: impedir sincronização duplicada

Em desktop é comum o usuário abrir duas abas. Em mobile, Service Worker e aba também podem tentar executar ações próximas.

Usar Web Locks quando disponível:

```js
await navigator.locks.request(`evolutus-sync-${userId}`, async () => {
  await runSync()
})
```

Criar fallback simples em memória para navegadores sem suporte.

O lock não substitui idempotência do servidor. Ele apenas reduz concorrência desnecessária.

---

# 15. BroadcastChannel: manter abas alinhadas

Criar canal:

```text
evolutus-sync
```

Eventos possíveis:

```text
sync:start
sync:success
sync:error
mutation:created
entity:updated
session:logout
```

Quando uma aba sincronizar, as outras recebem a informação e atualizam seus estados locais sem iniciar outro sync imediatamente.

---

# 16. Conectividade: `navigator.onLine` é apenas um sinal

Não considerar `navigator.onLine === true` como prova de que o Supabase está acessível.

Usar o estado assim:

```text
navigator.onLine === false
→ certamente evitar tentativa imediata

navigator.onLine === true
→ pode tentar sincronizar
```

A confirmação real é o resultado da requisição de sync.

Opcionalmente implementar um probe leve com timeout, mas não criar polling constante.

---

# 17. Supabase: arquitetura server-side para sync

Criar uma migration específica, por exemplo:

```text
supabase/migrations/YYYYMMDDHHMMSS_offline_workout_sync.sql
```

## 17.1 Idempotência

Criar uma tabela de recibos de mutação:

```sql
create table public.offline_mutation_receipts (
  user_id uuid not null,
  mutation_id uuid not null,
  operation text not null,
  entity_id uuid,
  applied_at timestamptz not null default now(),
  result jsonb,
  primary key (user_id, mutation_id)
);
```

Essa tabela impede que uma repetição da mesma mutação seja aplicada duas vezes.

Ela não deve ser exposta para leitura/escrita direta pelo cliente.

Definir política de retenção somente depois de validar o tempo máximo aceitável de dispositivos offline. Evitar apagar recibos cedo demais.

## 17.2 RPC

Sugestão:

```text
sync_workout_mutations(p_mutations jsonb)
```

Responsabilidades:

1. exigir usuário autenticado;
2. obter `auth.uid()` no servidor;
3. validar tamanho máximo do lote;
4. validar cada `mutation_id`;
5. validar o conjunto fechado de operações permitidas;
6. rejeitar `user_id` diferente de `auth.uid()`;
7. detectar mutação já aplicada;
8. validar ownership dos registros;
9. aplicar alterações;
10. registrar o receipt;
11. retornar ACK ou conflito por item;
12. nunca aceitar nome de tabela/coluna vindo do payload;
13. preservar as regras existentes de RLS/constraints.

Formato de resposta sugerido:

```json
{
  "accepted": [
    {
      "mutation_id": "...",
      "entity_id": "...",
      "server_version": 4,
      "server_updated_at": "..."
    }
  ],
  "conflicts": [],
  "rejected": []
}
```

## 17.3 SECURITY DEFINER

Se a RPC precisar ser `SECURITY DEFINER`, usar com extremo cuidado:

- `SET search_path` explícito;
- validar `auth.uid()`;
- nenhuma SQL dinâmica baseada no cliente;
- revoke de `PUBLIC` e `anon`;
- grant somente para `authenticated` quando aplicável;
- ownership das funções controlado;
- testes de acesso negativo obrigatórios.

Preferir funções específicas de domínio a uma função genérica que possa alterar qualquer tabela.

---

# 18. Versionamento e conflitos

Adicionar `server_version` ou equivalente nas entidades que podem receber alterações concorrentes.

Exemplo:

```text
cliente leu versão 4
cliente ficou offline
outro aparelho atualizou para versão 5
primeiro aparelho tenta atualizar usando base_version = 4
```

O servidor não deve sobrescrever silenciosamente a versão 5.

Resposta:

```text
CONFLICT
```

## Estratégia por domínio

### Criação de série

Usar UUID estável + `upsert` idempotente.

### Alteração de carga/repetição

Usar `base_version`.

Se houver conflito:

- se os valores forem iguais, considerar resolvido;
- se apenas um lado mudou determinado campo e houver merge seguro, mesclar;
- se ambos alteraram o mesmo campo, sinalizar conflito.

### Exclusão

Usar tombstone (`deleted_at`) quando necessário para sincronização multi-dispositivo, em vez de apagar imediatamente dados sincronizáveis.

### Finalização de treino

O servidor deve validar que a operação pertence ao usuário e que o estado do treino permite finalização.

### Dados derivados

Não sincronizar resultados derivados que podem ser recalculados.

Exemplo:

```text
progresso diário
recordes
estatísticas
rankings
```

Enviar fatos brutos e recalcular no servidor.

---

# 19. Timestamps

Não confiar no relógio do aparelho para decisões autoritativas.

Pode existir:

```text
device_updated_at
```

para ordenação/UX local.

Mas o servidor deve manter:

```text
updated_at = now()
```

para estado oficial.

Se uma regra depende de janela temporal, promoção, evento, prazo ou dinheiro, validar sempre com tempo do servidor.

---

# 20. Sessão e autenticação offline

Um usuário que já estava autenticado pode continuar acessando **dados locais permitidos** se ficar sem internet.

Porém:

- login novo exige internet;
- recuperação de senha exige internet;
- troca de conta exige internet para validar sessão;
- sincronização exige sessão Supabase válida;
- se refresh token expirar, manter dados locais intactos, mas pausar sync até autenticação ser restabelecida.

## Particionamento por usuário

Todo registro local sensível deve possuir `user_id`.

Nunca permitir que dados locais da conta A apareçam após entrar na conta B.

No logout:

- parar Sync Engine;
- limpar caches de perfil da sessão;
- decidir explicitamente se dados de treino locais devem ser apagados ou mantidos cifrados/bloqueados;
- por padrão, para simplificar privacidade, limpar dados locais privados da conta após logout confirmado, preservando apenas catálogo público/cache genérico.

---

# 21. Service Worker novo

O Service Worker deve cuidar de **arquivos e navegação**, não ser o banco dos treinos.

Separar caches:

```text
evolutus-shell-vX
evolutus-static-vX
evolutus-images-vX
evolutus-runtime-vX
```

## Estratégias

### Navegação HTML

```text
Network First
→ timeout curto/moderado
→ fallback para app shell
```

### JS/CSS com hash

```text
Cache First
```

Como o nome muda quando o conteúdo muda, esses assets são seguros para cache longo.

### Imagens de exercício

```text
Cache First
+ limite de quantidade
+ expiração
```

### Avatar e imagens que podem mudar

```text
Stale While Revalidate
```

### APIs Supabase

Não fazer cache genérico de REST/Auth/Realtime no Service Worker.

Dados de domínio offline devem passar pela camada IndexedDB.

### Financeiro

```text
Network Only
```

---

# 22. Reduzir o precache

Hoje o plugin gera `ASSETS` a partir de praticamente todos os arquivos do bundle.

Alterar para precache apenas do mínimo necessário para inicialização offline.

Exemplo conceitual:

```text
/index.html
manifest
ícones
CSS inicial
JS bootstrap
chunk da tela inicial autenticada
chunk necessário para modo offline de treino
```

Rotas grandes que o usuário talvez nunca abra não precisam obrigatoriamente ser baixadas na instalação da PWA.

Exemplos:

```text
Admin
relatórios pesados
vitrine
páginas raras
```

podem continuar sob demanda.

---

# 23. Não migrar tudo para Workbox de uma vez

O Evolutus já possui Service Worker próprio e lógica de atualização que resolveu problemas reais de deploy.

Portanto:

1. primeiro refatorar a estratégia atual preservando o mecanismo de atualização;
2. introduzir offline data independentemente;
3. somente depois avaliar `vite-plugin-pwa`/Workbox se reduzir manutenção.

Não misturar uma troca total do Service Worker com a primeira implementação da outbox.

Se Workbox for adotado, preferir `injectManifest` para manter controle do código customizado.

---

# 24. Atualizações da PWA sem perda de dados

O fluxo atual oferece atualização manual. Manter essa filosofia.

Antes de executar `window.location.reload()`:

```text
há formulário não salvo?
há transação IndexedDB em andamento?
há mutações locais ainda não persistidas?
```

Mutações já persistidas na outbox não impedem atualização; elas sobreviverão ao reload.

A mensagem pode mudar de:

```text
"Salve seus registros antes de continuar"
```

para:

```text
"Seus registros já foram salvos neste aparelho. O app será reiniciado para aplicar a nova versão."
```

somente quando a nova arquitetura garantir essa persistência.

---

# 25. Substituir o bloqueio offline atual

Remover o comportamento que executa:

```js
content.inert = true
```

apenas porque o navegador ficou offline.

Substituir a tela cheia por um aviso discreto.

Exemplo:

```text
┌─────────────────────────────────────────┐
│ Sem internet • alterações salvas aqui  │
└─────────────────────────────────────────┘
```

Ao sincronizar:

```text
Sincronizando 4 alterações…
```

Depois:

```text
✓ Tudo sincronizado
```

Se houver problema permanente:

```text
⚠ 1 alteração precisa de atenção
[Ver detalhes]
```

Evitar avisos constantes que atrapalhem a execução do treino.

---

# 26. Indicador de estado de sincronização

Criar componente único `SyncStatus`.

Estados:

```text
synced
pending
syncing
offline
error
conflict
```

Exemplo de textos:

```text
✓ Sincronizado
☁ Salvo neste aparelho
↻ Sincronizando…
○ Sem internet
⚠ Falha ao sincronizar
⚠ Conflito encontrado
```

Não mostrar detalhes técnicos ao usuário comum.

---

# 27. Imagens: redução forte de peso

O projeto possui imagens grandes que podem penalizar celulares de entrada.

A pipeline já possui `sharp`; aproveitar isso.

Criar pipeline para gerar:

```text
AVIF
WebP
fallback original quando necessário
```

Tamanhos sugeridos para imagens responsivas:

```text
360w
640w
960w
1280w
```

Uso:

```html
<picture>
  <source type="image/avif" srcset="..." />
  <source type="image/webp" srcset="..." />
  <img ... />
</picture>
```

## Regras

- imagens abaixo da primeira dobra → `loading="lazy"`;
- imagem LCP → não usar lazy;
- definir `width` e `height` para reduzir CLS;
- evitar servir imagem de desktop gigante em tela de 360 px;
- imagens de catálogo de exercícios devem entrar em runtime cache somente após uso;
- limitar cache de imagens.

---

# 28. Catálogo de exercícios offline

O catálogo próprio possui aproximadamente 868 exercícios válidos, quantidade perfeitamente administrável localmente.

Estratégia:

```text
Supabase exercise_catalog
          │
          ▼
versão do catálogo
          │
          ▼
IndexedDB exerciseCatalog
```

Adicionar uma versão ou `updated_at` global para saber quando atualizar.

Opções:

1. RPC que retorna versão do catálogo;
2. tabela/meta com `catalog_version`;
3. sincronização incremental por `updated_at`.

Para a primeira versão, pode ser suficiente:

```text
se versão remota != versão local
→ baixar catálogo atualizado
→ substituir transacionalmente
```

Não baixar novamente os 868 exercícios a cada abertura do app.

---

# 29. Histórico recente offline

Não é necessário armazenar todo o histórico do usuário indefinidamente.

Sugestão inicial:

- treino ativo;
- treinos recentes suficientes para a interface principal;
- dados necessários para pré-preenchimento de carga/repetições;
- dados necessários para histórico compacto.

Definir retenção por necessidade de produto, não por conveniência técnica.

A aba de histórico completo pode solicitar dados adicionais ao servidor quando online.

---

# 30. Prefetch inteligente

Não baixar tudo antecipadamente.

Prefetch somente quando houver benefício real.

Exemplos:

- usuário abre a tela de treino → preparar chunks do executor;
- usuário possui treino programado → sincronizar estrutura desse treino;
- usuário acessa exercícios frequentemente → manter catálogo local;
- em `saveData === true`, evitar downloads não essenciais;
- em conexão lenta, priorizar shell e treino atual.

---

# 31. Code splitting e bundle

Manter o `React.lazy()` já existente e expandir onde fizer sentido.

Auditar chunks gerados pelo Vite.

Adicionar ferramenta de análise somente em desenvolvimento/CI, por exemplo um visualizador de bundle.

Criar budgets.

Exemplo inicial — valores devem ser definidos após medir a `main` atual:

```text
JS inicial gzip: não aumentar acima do baseline sem justificativa
CSS inicial: não aumentar acima do baseline sem justificativa
nenhuma imagem crítica acima do budget definido
nenhum chunk novo grande sem code splitting
```

Não escolher números arbitrários antes de medir o build atual.

O CI deve comparar baseline e alertar regressões.

---

# 32. Dependências

Durante a auditoria:

- remover dependências sem uso;
- impedir reintrodução de Firebase;
- preferir APIs nativas quando simples;
- não adicionar biblioteca grande para resolver um problema pequeno;
- manter bibliotecas de análise apenas em `devDependencies`.

---

# 33. Renderização de listas grandes

Para históricos, comunidades e listas grandes:

- paginação/cursor no servidor;
- `content-visibility: auto` para blocos longos quando apropriado;
- virtualização apenas se a quantidade real justificar;
- evitar renderizar centenas de cards ocultos.

Não adicionar virtualização prematuramente em listas pequenas.

---

# 34. Persistência do armazenamento

Depois que o usuário realmente utilizar o modo offline/instalar a PWA, solicitar:

```js
navigator.storage.persist()
```

Tratar retorno `true` e `false`.

Também monitorar:

```js
navigator.storage.estimate()
```

Nunca assumir que armazenamento web é infinito.

Criar política para limpar:

- imagens antigas;
- caches antigos;
- histórico local fora da janela necessária;
- versões antigas do catálogo;
- arquivos temporários.

Nunca apagar itens `pending/conflict/failed` da outbox por limpeza automática.

---

# 35. Manifest aprimorado

Manter:

```json
{
  "display": "standalone",
  "scope": "/",
  "start_url": "/"
}
```

Adicionar gradualmente:

- screenshots mobile (`narrow`);
- screenshots desktop/tablet (`wide`);
- shortcuts;
- ícones completos e maskable;
- metadados consistentes de cor/branding.

Shortcuts possíveis:

```text
Iniciar treino
Exercícios
Histórico
```

Os atalhos devem apontar para rotas válidas e respeitar autenticação.

---

# 36. Safe areas e diferentes aparelhos

Revisar sistematicamente:

```text
320–360 px
390–430 px
600–767 px
768–1024 px
> 1024 px
portrait
landscape
```

Usar:

```css
padding-bottom: env(safe-area-inset-bottom);
```

quando necessário.

Preferir unidades modernas como `dvh` em interfaces de tela cheia onde a barra do navegador móvel impacta a altura.

Testar:

- teclado aberto;
- notch;
- instalação standalone;
- Safari iOS;
- Chrome Android;
- Samsung Internet;
- desktop Chromium;
- Firefox quando aplicável.

---

# 37. Push e Service Worker

O projeto atual possui evolução de infraestrutura de push no Supabase.

No cliente PWA, evitar registrar dois Service Workers concorrendo pelo mesmo `scope`.

Se Web Push for implementado/expandido, integrar os listeners `push` e `notificationclick` no mesmo Service Worker principal ou em arquitetura comprovadamente compatível.

O backend continua responsável por:

- outbox de notificações;
- jobs;
- telemetria;
- retries server-side.

O Service Worker do navegador é somente o receptor/renderer da notificação.

---

# 38. Telemetria da sincronização

Não registrar payloads completos de treino em logs de telemetria sem necessidade.

Métricas úteis:

```text
sync_attempt
sync_success
sync_failure
sync_conflict
pending_count
oldest_pending_age
batch_size
sync_duration_ms
offline_session_started
offline_mutation_created
storage_usage
```

Associar apenas identificadores técnicos necessários e respeitar a política de privacidade.

Painel mínimo:

```text
% de sync com sucesso
idade máxima de item pendente
quantidade de conflitos
quantidade de falhas permanentes
tempo médio de sincronização
```

---

# 39. Core Web Vitals e performance real

Medir em produção:

- LCP;
- INP;
- CLS;
- TTFB quando relevante;
- tamanho dos bundles;
- tempo de boot offline;
- tempo até primeira interação no executor de treino.

Objetivos gerais:

```text
LCP ≤ 2,5 s
INP ≤ 200 ms
CLS ≤ 0,1
```

Medir por percentil e dispositivo real, não somente Lighthouse local.

Adicionar `web-vitals` ou instrumentação equivalente somente se a coleta estiver de acordo com a política de privacidade.

---

# 40. Testes obrigatórios

## 40.1 Unitários

Testar:

- criação da mutação;
- compactação;
- ordenação;
- retry/backoff;
- parse de ACK;
- parse de conflito;
- migrations do IndexedDB;
- limpeza de cache;
- particionamento por usuário.

## 40.2 Integração frontend

Adicionar testes de navegador para:

```text
abrir online
ficar offline
registrar série
fechar/reabrir
confirmar dado local
voltar online
confirmar sync
recarregar
confirmar persistência remota
```

Playwright é uma boa opção como dependência de desenvolvimento por permitir controlar contexto offline.

## 40.3 Supabase / SQL

Testes obrigatórios:

- usuário A não sincroniza dado do usuário B;
- `anon` não executa RPC protegida;
- mutation duplicada não duplica dados;
- lote parcialmente duplicado funciona;
- operação desconhecida é rejeitada;
- payload inválido é rejeitado;
- lote maior que limite é rejeitado;
- conflito de versão retorna conflito;
- finish não ignora regras existentes;
- constraints atuais continuam valendo.

## 40.4 Testes manuais reais

Executar em pelo menos:

```text
Android intermediário
Android de entrada
Chrome desktop
PWA instalada Android
Safari/iPhone quando disponível
iPhone PWA instalada quando disponível
Tablet quando disponível
```

Cenários:

- modo avião durante treino;
- desligar Wi‑Fi no meio da série;
- reconectar em rede lenta;
- alternar Wi‑Fi/4G;
- fechar app com mutações pendentes;
- reiniciar aparelho;
- abrir duas abas;
- sessão expirar durante offline;
- deploy novo com mutações pendentes;
- armazenamento quase cheio.

---

# 41. Teste de caos básico

O sincronizador deve ser testado com falhas provocadas:

```text
request timeout
HTTP 500
HTTP 401
HTTP 403
RPC indisponível
resposta parcial
conexão cai após envio mas antes de receber ACK
mesma mutação enviada duas vezes
ordem de resposta inesperada
```

O caso mais importante é:

```text
servidor aplicou a mutação
conexão caiu antes do cliente receber ACK
cliente tenta novamente
```

A idempotência por `mutation_id` precisa garantir que o dado seja aplicado **uma única vez**.

---

# 42. Estratégia de implementação por fases

## Fase 0 — Auditoria da `main` atual

Antes de codificar:

1. confirmar branch/commit atual;
2. confirmar que Firebase já foi removido do projeto atual;
3. mapear services de treino atuais;
4. mapear tabelas/RPCs atuais;
5. mapear fluxo exato de execução e finalização;
6. medir bundles atuais;
7. registrar comportamento atual do Service Worker;
8. executar testes/lint/build baseline.

**Entrega:** relatório curto de baseline.

---

## Fase 1 — PWA leve e Service Worker

Implementar:

- reduzir precache;
- separar caches;
- limitar cache de imagens;
- manter navegação network-first;
- preservar mecanismo de update seguro;
- otimizar imagens críticas;
- adicionar budgets de bundle;
- melhorar manifest;
- não alterar ainda escrita de treino.

**Critério:** nenhuma regressão funcional e redução ou estabilização do custo inicial.

---

## Fase 2 — IndexedDB somente leitura

Implementar:

- infraestrutura do banco local;
- schema/migrations;
- catálogo de exercícios local;
- cache de treino atual;
- histórico recente local;
- persistência/quota;
- leitura offline sem escrita sincronizável ainda.

**Critério:** abrir app offline e consultar dados já sincronizados.

---

## Fase 3 — Treino local-first

Alterar fluxo de execução:

- gravação de séries no IndexedDB;
- outbox;
- `sync_status`;
- remover bloqueio fullscreen offline;
- UI de status;
- persistência ao fechar/reabrir.

Inicialmente pode existir feature flag:

```text
VITE_OFFLINE_TRAINING_ENABLED
```

**Critério:** treino completo pode ser registrado sem internet e permanece após reload.

---

## Fase 4 — RPC de sincronização Supabase

Implementar:

- migration server-side;
- mutation receipts;
- RPC específica;
- idempotência;
- controle de versão;
- validações;
- grants;
- testes negativos.

**Critério:** fila local sincroniza sem duplicação.

---

## Fase 5 — Sync Engine robusto

Implementar:

- lotes;
- retry/backoff;
- Web Locks;
- BroadcastChannel;
- compactação;
- conflitos;
- integração com ciclo de vida da página;
- sync no evento `online`;
- botão manual;
- Background Sync opcional.

**Critério:** múltiplas abas/conexões instáveis não geram duplicação.

---

## Fase 6 — Performance e telemetria

Implementar:

- Web Vitals;
- métricas de sync;
- bundle report CI;
- otimização adicional de imagens;
- lazy/preload inteligente;
- listas longas;
- limpeza de storage.

**Critério:** métricas observáveis e budgets definidos.

---

## Fase 7 — Rollout gradual

Não liberar para 100% dos usuários imediatamente.

Sugestão:

```text
feature flag interna
→ equipe/testadores
→ pequena porcentagem
→ observar telemetria
→ ampliar gradualmente
```

Se o projeto não tiver infraestrutura de flags por porcentagem, começar com uma flag por conta/ambiente.

O rollback deve ser capaz de:

- parar novas mutações offline;
- manter e sincronizar a fila existente;
- nunca descartar registros pendentes.

---

# 43. Feature flags sugeridas

```text
VITE_OFFLINE_READ_ENABLED
VITE_OFFLINE_TRAINING_ENABLED
VITE_SYNC_ENGINE_ENABLED
VITE_SYNC_TELEMETRY_ENABLED
```

Não usar flags para contornar segurança server-side.

---

# 44. Migração dos serviços atuais

Evitar componentes fazendo simultaneamente:

```text
setState
Supabase
IndexedDB
outbox
```

Centralizar.

Exemplo de API desejada:

```js
await workoutService.completeSet({
  workoutId,
  exerciseId,
  setId,
  weight,
  repetitions,
})
```

Internamente:

```text
workoutService
    │
    ├─ LocalRepository
    ├─ OutboxRepository
    └─ SyncScheduler
```

A UI não precisa saber se naquele instante existe internet.

---

# 45. Fonte de verdade na UI

Durante um treino em andamento, a UI deve renderizar prioritariamente o estado local persistido.

Não fazer:

```text
salva local
↓
sync
↓
faz refetch do servidor
↓
substitui tudo cegamente
```

Isso pode apagar visualmente alterações ainda pendentes.

Fazer reconciliação:

```text
server snapshot
+
local pending mutations
=
view model atual
```

Após ACK, consolidar.

---

# 46. Realtime do Supabase

Realtime pode continuar sendo usado onde já fizer sentido, mas não deve competir com alterações locais pendentes.

Ao receber update remoto para uma entidade com mutação local pendente:

1. comparar `server_version`;
2. não sobrescrever imediatamente a versão local;
3. atualizar base remota conhecida;
4. rodar reconciliador;
5. sinalizar conflito somente quando necessário.

---

# 47. Privacidade do IndexedDB

Não armazenar offline dados além do necessário.

Evitar principalmente:

- dados financeiros;
- documentos jurídicos completos desnecessários;
- informações administrativas;
- segredos;
- tokens manualmente duplicados;
- service role;
- chaves privadas.

Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` no cliente.

IndexedDB é isolado pela origem, mas não deve ser tratado como cofre criptográfico.

---

# 48. Cache e headers no servidor

Configurar host/CDN para assets versionados:

```text
Cache-Control: public, max-age=31536000, immutable
```

somente para arquivos que possuem hash de conteúdo no nome.

Para `index.html`:

```text
cache curto / revalidate
```

para evitar shell antigo apontando para chunks removidos.

O Service Worker atual já foi modificado por causa de tela branca pós-deploy; qualquer alteração deve preservar essa proteção e ser testada em deploy real.

---

# 49. Critérios de aceite finais

A implementação só estará concluída quando todos os itens abaixo forem verdadeiros.

## Offline

- [ ] PWA abre offline após primeira carga válida.
- [ ] Treino atual fica disponível offline.
- [ ] Catálogo de exercícios fica disponível offline.
- [ ] Usuário conclui série offline.
- [ ] Usuário altera carga/reps offline.
- [ ] Usuário fecha/reabre e não perde alterações.
- [ ] App não bloqueia toda a interface ao perder internet.

## Sync

- [ ] Dados sincronizam ao voltar internet.
- [ ] Reenvio da mesma mutação não duplica dados.
- [ ] Fila sobrevive a refresh/update do app.
- [ ] Duas abas não duplicam sync.
- [ ] Falha de rede não perde mutação.
- [ ] Conflito não é sobrescrito silenciosamente.
- [ ] Usuário consegue ver itens que precisam de atenção.

## Segurança

- [ ] RLS continua ativa.
- [ ] RPC rejeita usuário incorreto.
- [ ] `anon` não executa operação protegida.
- [ ] Operações financeiras não entram na outbox offline.
- [ ] Dados de uma conta nunca aparecem em outra.
- [ ] Nenhuma service role/chave secreta chega ao frontend.

## PWA

- [ ] Precache reduzido ao essencial.
- [ ] Cache de imagens possui limite/expiração.
- [ ] Atualização da PWA não perde registros.
- [ ] Manifest validado.
- [ ] Ícones/maskable validados.
- [ ] Instalação Android validada.
- [ ] Instalação iOS validada quando disponível.

## Performance

- [ ] Bundle baseline registrado.
- [ ] Regressões de bundle detectáveis em CI.
- [ ] Imagens grandes otimizadas.
- [ ] Rotas pesadas continuam lazy.
- [ ] Core Web Vitals monitoráveis.

## Qualidade

- [ ] lint passa;
- [ ] testes atuais continuam passando;
- [ ] novos testes de offline/sync passam;
- [ ] build de produção passa;
- [ ] nenhum commit/push/deploy é feito sem autorização explícita.

---

# 50. Ordem recomendada de arquivos/migrations

Uma sequência prática:

```text
1. src/offline/db/schema.js
2. src/offline/db/openDatabase.js
3. src/offline/db/repositories/*
4. src/offline/storage/*
5. src/offline/connectivity/*
6. src/components/SyncStatus.jsx
7. refactor PwaControls.jsx
8. cache local do catálogo
9. cache local do treino atual
10. outboxRepository.js
11. refactor workoutService
12. feature flag do treino offline
13. migration SQL sync
14. syncEngine.js
15. syncScheduler.js
16. syncLock.js
17. conflictResolver.js
18. BroadcastChannel
19. Service Worker cache/runtime
20. telemetria/performance
21. testes E2E offline
```

Não alterar todos os domínios ao mesmo tempo.

---

# 51. Pseudocódigo do serviço de treino

```js
export async function completeSet(input) {
  const user = await requireCurrentUser()
  const now = new Date().toISOString()

  const entity = {
    id: input.setId ?? crypto.randomUUID(),
    user_id: user.id,
    workout_id: input.workoutId,
    exercise_id: input.exerciseId,
    weight: input.weight,
    repetitions: input.repetitions,
    completed_at: now,
    device_updated_at: now,
    sync_status: 'pending',
  }

  const mutation = {
    mutation_id: crypto.randomUUID(),
    user_id: user.id,
    aggregate_type: 'workout',
    aggregate_id: input.workoutId,
    entity_type: 'workout_set',
    entity_id: entity.id,
    operation: 'workout_set.upsert',
    payload: entity,
    status: 'pending',
    created_at: now,
  }

  await localDb.transaction(['workoutSets', 'outbox'], async (tx) => {
    await tx.workoutSets.put(entity)
    await tx.outbox.add(mutation)
  })

  syncScheduler.request()
  return entity
}
```

Esse código é ilustrativo; adaptar aos nomes/tabelas reais da `main` atual.

---

# 52. Pseudocódigo do Sync Engine

```js
export async function requestSync() {
  if (!navigator.onLine) return

  const user = await getCurrentUser()
  if (!user) return

  return withSyncLock(user.id, async () => {
    while (true) {
      const batch = await outbox.getNextBatch(user.id, 50)
      if (!batch.length) break

      try {
        const { data, error } = await supabase.rpc('sync_workout_mutations', {
          p_mutations: batch,
        })

        if (error) throw classifySyncError(error)

        await applySyncResult(data)
      } catch (error) {
        await handleSyncError(batch, error)
        break
      }
    }
  })
}
```

---

# 53. Regras de UX durante falhas

## Internet caiu

Não mostrar modal bloqueador.

```text
Sem internet • seus registros serão salvos neste aparelho
```

## Internet voltou

```text
Sincronizando…
```

Sem toast para cada série. Evitar ruído.

## Sync concluído

Pode atualizar discretamente:

```text
✓ Sincronizado
```

## Falha temporária

Não assustar o usuário:

```text
Não foi possível sincronizar agora. Seus dados continuam salvos neste aparelho.
```

## Falha permanente

```text
1 alteração precisa de atenção.
[Ver detalhes]
```

Nunca dizer que algo foi sincronizado antes do ACK do servidor.

---

# 54. O que não fazer

- Não usar `localStorage` como banco de treinos.
- Não depender apenas de `navigator.onLine`.
- Não depender apenas de Background Sync.
- Não colocar tokens na outbox.
- Não armazenar requests HTTP crus para replay.
- Não usar `last write wins` para tudo.
- Não sincronizar dinheiro offline.
- Não permitir RPC genérica com tabela vinda do cliente.
- Não desabilitar RLS para facilitar sync.
- Não usar service role no browser.
- Não apagar a outbox em atualização de versão.
- Não limpar mutações pendentes por quota/cache cleanup.
- Não bloquear o aplicativo inteiro porque está offline.
- Não pré-carregar todo o produto só porque é PWA.
- Não transformar imagens grandes em cache infinito.
- Não reintroduzir Firebase.
- Não fazer push/deploy antes de testes e autorização.

---

# 55. Estratégia recomendada para o Evolutus

A implementação deve priorizar três resultados concretos:

### 1. Leveza

- app shell menor;
- chunks por rota;
- imagens otimizadas;
- cache sob demanda;
- budgets de build;
- evitar dependências desnecessárias.

### 2. Robustez

- IndexedDB transacional;
- outbox;
- idempotência server-side;
- controle de versão;
- retries;
- Web Locks;
- testes de caos;
- atualização sem perda de registros.

### 3. Experiência de app

- inicia rápido;
- continua funcionando sem internet;
- estado de sync discreto;
- instalação correta;
- layout adaptado a diferentes aparelhos;
- comportamento consistente em Android, iOS, tablet e desktop.

---

# 56. Meta final

A experiência ideal é esta:

```text
Usuário chega à academia
        │
        ▼
abre Evolutus
        │
        ▼
Wi‑Fi ruim / 4G instável
        │
        ▼
nenhum problema
        │
        ▼
registra todo o treino
        │
        ▼
IndexedDB + outbox
        │
        ▼
fecha o app
        │
        ▼
conexão volta
        │
        ▼
Evolutus sincroniza com Supabase
        │
        ▼
PostgreSQL confirma cada mutação
        │
        ▼
usuário vê "✓ Sincronizado"
```

Esse modelo mantém o Evolutus como uma única aplicação web/PWA, reduz manutenção, melhora muito a experiência mobile e deixa aberta a possibilidade de empacotar a mesma base com Capacitor no futuro, caso a presença na Play Store passe a justificar o custo adicional.

---

# 57. Regra de execução para a IA/agente que implementar

Antes de qualquer alteração:

1. ler a `main` atual;
2. mapear exatamente os fluxos e migrations existentes;
3. não usar este documento para sobrescrever código mais novo;
4. implementar uma fase por vez;
5. executar testes/lint/build após cada fase;
6. apresentar diff e riscos antes de migrations destrutivas;
7. preservar compatibilidade com dados existentes;
8. não criar dependência de Firebase;
9. não alterar regras financeiras para fazê-las funcionar offline;
10. não fazer commit, push ou deploy sem autorização explícita;
11. antes de qualquer push/deploy, confirmar identidade GitHub e `remote` do repositório corporativo correto.

A implementação deve ser incremental e reversível. O objetivo não é apenas “funcionar offline”, mas garantir que **nenhum treino seja perdido, duplicado ou silenciosamente sobrescrito**.
