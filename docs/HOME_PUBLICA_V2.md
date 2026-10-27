# Home pública V2

Implementação incremental a partir do merge `604f16c` (PR #84). Sem deploy, migrations ou alterações de configuração em produção nesta tarefa. Prévia de desenvolvimento na porta 5173, branch `feat/public-home-v2`, worktree `/tmp/evolutus-public-home-v2`.

## Interface e menu

Banner, hero, CTAs, SEO, HTML estático e ilhas Primer preservados. O destaque Catálogo Evolutus fica entre o hero e os três passos. As quatro capacidades descrevem fichas, catálogo oficial, evolução e comunidades, existentes no app. Grupo muscular/equipamento existem na busca do catálogo. `/exercicios` exige autenticação: a ação pública vai para `/cadastro`, sem anunciar uma rota pública inexistente.

Causa do corte do menu: `ActionMenu` do Primer 37 usa deslocamento padrão de 4 px em relação **ao botão**, não ao header. O ponto cai dentro da área inferior do header sticky (`z-index: 20`). O portal padrão do Primer tem contexto com `z-index: 1`; o header pinta sobre o início do painel. Fullscreen mobile também removia o arredondamento e introduzia um segundo contêiner de rolagem com altura indefinida.

A solução mantém `ActionMenu.Overlay`, `ActionList`, portal, largura `small`, alinhamento `end`, teclado e foco do Primer. Usa suas propriedades suportadas `top` e `position`: mede a borda inferior real do header, soma o token de 8 px, mantém o painel fixo abaixo do header sticky e preserva a ancoragem horizontal do Primer. Um `ResizeObserver` acompanha mudanças no header somente enquanto o menu está aberto. A altura disponível usa `100dvh`, essa coordenada e safe area; há uma única rolagem interna. Nenhum aumento de z-index, margem compensatória, transformação ou `!important`.

O teste de navegador exige separação de 8 px, alinhamento do lado direito ao botão, raio superior positivo e hit test da borda superior, além do primeiro item descoberto. Abrir, fechar, Escape/foco, clique externo, rolagem com painel aberto, navegação e reabertura são exercitados em 320/390/768/1440 px, claro/escuro, alturas 900/420 px. As capturas ficam locais, conforme a regra existente `/docs/**/*.png` do `.gitignore`; os scripts e resultados JSON ficam versionados e permitem regenerá-las. Capturas reais: [antes](public-home-v2-evidence/before/), [depois sem snapshot configurado](public-home-v2-evidence/after/), [build validado com fixture](public-home-v2-evidence/validated/).

Também foi corrigida uma recarga preexistente do Turbo: um script de autenticação exclusivo das páginas secundárias tinha `data-turbo-track="reload"`, forçando reload ao entrar/sair da Home. Apenas essa marcação foi removida; o módulo e seus guards de inscrição/auth permanecem intactos. O teste comprova que a mesma janela/header persistem durante dez idas e voltas.

## Contador: eventos duráveis, snapshot e CDN

Foi escolhida a alternativa de snapshot no próprio PostgreSQL + CDN Vercel, em vez de Storage. O projeto já tem pg_cron e PostgREST; isso evita introduzir função externa, segredo de webhook, serviço pago ou dependência de Smart CDN. O objeto distribuído ao navegador é JSON, servido no mesmo domínio por `/api/public-catalog-snapshot`.

1. Um trigger adicional detecta somente entrada/saída da visibilidade `is_active AND status='published'`, inclusive inserts/deletes e caminhos administrativos alternativos. Edições de texto, rascunhos e pending_content não enfileiram recálculo. Os invariantes e RPCs administrativos existentes não mudam.
2. O evento atualiza uma geração na fila privada singleton **na mesma transação** da mudança. Rollback remove também o evento. Não há webhook não confirmado nem evento pré-commit processável.
3. O pg_cron existente executa `private.refresh_public_catalog_snapshot()` a cada minuto. Ele só enxerga eventos confirmados, trava a fila, reutiliza `get_exercise_catalog_revision()` para recalcular o total do estado atual e publica a única linha de `public.public_catalog_snapshot`.
4. Snapshot e ACK da geração são atômicos. Falha em qualquer etapa mantém a geração pendente para a próxima execução. Chamadas repetidas sem mudança retornam antes da RPC. O lock serializa workers/eventos; eventos concorrentes posteriores ficam pendentes. Não há incrementos/decrementos cegos do total nem payload de evento capaz de regredir o snapshot.
5. A migration já cria o snapshot inicial a partir da contagem real; não depende de uma publicação futura. A revisão pública é a geração monotônica em texto, não um bigint arredondado no JavaScript. `updated_at` indica quando o snapshot foi publicado, não sua validade: ele continua correto indefinidamente se a visibilidade não mudar.
6. A função HTTP Vercel faz apenas um SELECT da linha pré-calculada em um miss. **Jamais lê exercise_catalog nem executa RPC de contagem**, mesmo com cache frio ou parâmetros arbitrários. Usa chave anon já configurada; nenhuma service_role é necessária. Valida o resultado e retorna somente total/revisão/data.
7. Cache Vercel: `Vercel-CDN-Cache-Control: public, s-maxage=60, must-revalidate`. Navegador: `Cache-Control: public, max-age=0, must-revalidate`. Sem stale-while-revalidate ou stale-if-error. Mecanismo conforme [documentação Vercel](https://vercel.com/docs/caching/cache-control-headers). Não há promessa de invalidação instantânea ou zero requisições. Em condições saudáveis: até cerca de **120 segundos + processamento/rede** (cron até 60 s + CDN até 60 s). Outages não têm prazo absoluto garantido.
8. Erros do backend são 503 não cacheáveis e sem detalhes internos. O frontend mantém texto neutro em falha, offline ou JSON inválido. Nenhum zero é inventado. Zero válido do snapshot é exibido corretamente.

O script standalone tem cerca de 1 KB gzip, não importa SDK Supabase, usa IntersectionObserver, valida o JSON e formata em pt-BR. Faz uma leitura por montagem visível, sem polling/Realtime/storage. Abort/disconnect em `turbo:before-cache`; dados numéricos não são reutilizados pelo snapshot de DOM do Turbo. `turbo:load` não duplica listeners, observers nem requisições. O service worker existente não intercepta esse endpoint nem o script standalone; não foi alterado.

## Segurança e confirmação do ambiente real

Consulta **somente leitura** em produção confirmou migrations `20261026000006`, `20261117000001`, `20261126000001`, `20261126000002`, pg_cron, RPC de revisão, RLS do catálogo, invariante de publicação e **867 publicados** no instante da inspeção. O snapshot novo ainda não existia. Esse número não está embutido no produto.

O catálogo já concede privilégios de tabela amplos aos papéis padrão, mas a escrita é negada pelas policies RLS existentes; não se confundiu GRANT com autorização efetiva nem se alteraram essas regras. A tabela nova revoga explicitamente toda escrita de anon/authenticated/service_role e só concede SELECT. A fila é privada; as funções do processador/gatilho têm EXECUTE revogado de todos esses papéis e de PUBLIC. Apenas o dono confiável/cron executa o worker. Não existe endpoint público de atualização, segredo no bundle ou evento externo manipulável. CSP/CORS, auth e economia não mudaram.

Monitoramento operacional (executar como operador confiável):

```sql
select generation, published_generation, requested_at
from private.public_catalog_refresh;
select * from cron.job where jobname = 'refresh-public-catalog-snapshot';
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname='refresh-public-catalog-snapshot')
order by start_time desc limit 10;
```

Uma geração pendente por mais de dois ciclos exige verificar o job e seus erros. Reiniciar o job retoma do estado persistido; a correção não exige editar uma contagem ou reemitir eventos manualmente. Para recuperação imediata após corrigir a causa, o dono pode executar `select private.refresh_public_catalog_snapshot()`.

## Arquivos e implantação futura

- `scripts/public-pages-template.mjs`, `public/public-home.css`: seção do catálogo, quatro diferenciais/ícones estáticos, passos por fichas, reserva de espaço e ajuste da marcação Turbo.
- `src/components/PublicNavigationMenu.jsx`, `src/styles/public-navigation-menu.css`: geometria medida e rolagem do painel Primer.
- `public/public-catalog-count.js`: enhancement pequeno e independente, com ciclo Turbo e fallback honesto.
- `api/public-catalog-snapshot.js`: transporte público validado/cacheado de uma linha precomputada.
- `supabase/migrations/20261127000001_public_catalog_snapshot.sql`: fila, snapshot com RLS, trigger, worker protegido, bootstrap e job. Apenas aditiva.
- `tests/public-catalog-snapshot.test.mjs`, `tests/public-pages.test.mjs`, `supabase/tests/public_catalog_snapshot_test.sql`: testes do transporte, lifecycle, HTML, eventos, retry e permissões.
- Scripts `public-home-v2-*`, `public-catalog-concurrency.mjs`, `test-public-catalog-db.mjs`, `prepare-public-catalog-auth.mjs`: evidências reproduzíveis, fixtures explícitas e banco local fixo, sem URLs remotas aceitas pelo harness SQL.
- Smokes públicos existentes: atualizados para o menu ancorado, quatro seções e espera pela troca do DOM Turbo. `public-smoke-fixtures.mjs` é opt-in (`PUBLIC_SMOKE_MOCKS=1`) e isola apenas a Vitrine. O servidor do smoke de CI responde um snapshot sintético local. Nada disso entra no produto.
- Workflow existente: acrescenta os quatro testes do novo contador ao job JS; não muda checks, permissões, limites ou budgets.

**Sem autorização de deploy nesta tarefa.** Quando for autorizado:

1. Verificar CI do commit final e revisar o plano remoto das migrations. Aplicar apenas a migration aditiva acima com o fluxo protegido habitual, antes do frontend. Conferir bootstrap, ACLs/RLS, job ativo e diferença zero entre snapshot e contagem real.
2. Backend HTTP requer `SUPABASE_URL` + `SUPABASE_ANON_KEY`, ou os aliases já existentes `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, no ambiente Vercel. Não requer segredo adicional. A prévia Vite encaminha a mesma leitura; antes da migration usa fallback, sem forjar snapshot.
3. Publicar o frontend/API. Confirmar GET anônimo 200, JSON mínimo, TTLs e `x-vercel-cache` MISS/HIT no deploy real. A eficácia do CDN Vercel não pode ser comprovada pelo servidor local.
4. Verificar uma publicação/retirada administrativa real autorizada, ou observar a próxima operação legítima: snapshot deve convergir em aproximadamente dois minutos, sem deploy. Não alterar dados reais apenas para gerar evidência nesta tarefa.
5. Rollback de frontend: promover o deploy anterior. A migration pode permanecer, pois não modifica contratos antigos. Se necessário interromper o contador, `select cron.unschedule('refresh-public-catalog-snapshot')` como operador; não excluir catálogo, fila ou histórico. Reagendar o mesmo comando após recuperar o serviço retoma os pendentes.

## Validação e limites

Executados: **2.255 testes JS aprovados**, quatro testes novos do contador, 17 de HTML público, 107 asserções pgTAP (25 do snapshot, 64 do lifecycle e 18 da revisão do catálogo), concorrência e retentativa automática pelo pg_cron real. A prova do cron injeta uma única falha de gravação no banco descartável e observa uma execução falha seguida por sucesso e convergência sem intervenção. Para encurtar somente esse teste local, usa cadência de 1 segundo e restaura o agendamento de 1 minuto ao terminar. Smokes existentes de menu, Turbo, Home Primer/sem JS e 128 verificações de header/auth aprovados. Build, budget e scanners de credenciais (1.570 arquivos fonte e 245 do build, zero achados) aprovados; lint com zero erros e 16 avisos preexistentes. A primeira execução de npm test no sandbox bloqueou subprocessos de fusos; a execução integral fora dessa restrição terminou 2.255/2.255.

Resultados exatos e métricas estão em [public-home-v2-evidence](public-home-v2-evidence/). Os screenshots `validated/*-fixture.png` e o adaptador 4174 usam **1.234 como fixture de teste**, nunca como contagem de produção. `after/` mostra a prévia real, com texto neutro até a migration/configuração.

O smoke sem mocks encontrou HTTP 403 na API externa da Vitrine; os testes de menu/Turbo subsequentes a isolaram com fixture explícita. Não se afirma que a integração real da Vitrine foi validada por essas execuções.

Medições de laboratório: três contextos frios por caso, CPU 4×, latência 40 ms, 1,5 MB/s. CLS máximo 0 antes/depois; medianas LCP 390 px: 444 → 408 ms; 1440 px: 424 → 480 ms. Requisições iniciais 14 → 16 (script leve + JSON, quando visível). Duração máxima observada de eventos variou de 200 → 248 ms no mobile e 216 → 136 ms no desktop. Isso **não é INP de campo** e não demonstra melhoria de latência; a máquina estava compartilhada com outros testes. O relatório preserva todas as amostras. Nenhum budget foi relaxado.

Pendência de integração: aplicar a migration e verificar cache/propagação no ambiente Vercel após autorização. Sem essa etapa não se declara o contador ativo em produção.


Comandos principais para reprodução (ajustar somente `CHROMIUM_PATH` ao navegador local):

```sh
npm run lint
npm test
npm run build
node --test tests/public-pages.test.mjs tests/public-catalog-snapshot.test.mjs
npm run budget
# Banco descartável exclusivo desta tarefa; não usar URLs ou dados remotos:
docker run -d --name evolutus_home_public_v2_test_db -e POSTGRES_PASSWORD=local-home-test -e POSTGRES_DB=postgres -v "$PWD:/workspace:ro" public.ecr.aws/supabase/postgres:17.6.1.166 postgres -c shared_preload_libraries=pg_cron,pg_net -c cron.database_name=postgres
# Aguardar pg_isready e instalar o schema oficial do GoTrue:
node scripts/prepare-public-catalog-auth.mjs
node scripts/test-public-catalog-db.mjs prepare
node scripts/test-public-catalog-db.mjs
node scripts/public-catalog-concurrency.mjs
node scripts/public-catalog-cron-retry.mjs
# Em terminais separados, para o build e as fixtures explicitamente sintéticas:
npm run preview -- --host 127.0.0.1 --port 4173
node scripts/public-home-v2-test-proxy.mjs
node scripts/public-home-v2-smoke.mjs
PUBLIC_SMOKE_MOCKS=1 PUBLIC_PREVIEW_URL=http://127.0.0.1:4174 node scripts/public-header-menu-smoke.mjs
PUBLIC_SMOKE_MOCKS=1 PUBLIC_PREVIEW_URL=http://127.0.0.1:4174 node scripts/public-turbo-smoke.mjs
PUBLIC_SMOKE_MOCKS=1 PUBLIC_PREVIEW_URL=http://127.0.0.1:4174 node scripts/public-home-primer-smoke.mjs
HEADER_WIDTHS=320,390,768,1440 node scripts/public-auth-header-smoke.mjs
```

## Endurecimento identificado no CI de publicação

O primeiro CI do PR #85 identificou que os dois novos SECURITY DEFINER não listavam `pg_temp` explicitamente no fim do search_path. A migration ainda não havia sido aplicada em produção. O caminho foi corrigido para `pg_catalog, public, private, pg_temp`, mantendo as verificações globais sem exceções ou relaxamento. O pgTAP do snapshot ganhou uma asserção específica (26 no total); foram reexecutados somente ele e os três arquivos de segurança afetados. As evidências locais anteriores permanecem associadas ao commit a385ab2; a integração deve usar o CI do novo commit.
