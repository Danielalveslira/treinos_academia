# Execução exclusiva por fichas

Base: `origin/main` em `429c33d`. Branch: `finance-ci-remove-free-workout` (prefixo já bloqueado para deploy no Vercel). Implementação isolada em worktree; alterações preexistentes no workspace original foram preservadas. Sem merge, deploy ou migration em produção.

## Contratos e arquitetura

Toda criação pela interface passa por `/treinar` e por uma ficha validada em `/novo-treino?ficha=<uuid>`. A RPC de execução continua verificando proprietário, estado e disponibilidade. O picker reutiliza o agregado e a chave de cache da Home, incluindo disponibilidade e conclusão confirmada; contagem de exercícios sozinha não habilita início. Só uma leitura de execução acontece ao iniciar. Filtro por intenção de exercício consulta detalhes limitados às fichas elegíveis, sem catálogo global. Não há polling nem dependências novas.

`WorkoutForm` permanece compartilhado: o contêiner de Histórico usa `initialValue`, inclusive com ficha nula/exercício removido; o contêiner de nova execução exige `sheetScope`. Essa escolha preserva o contrato de edição e evita duplicar saver, cardio e validações. Criação sem escopo é bloqueada no formulário e no handler de criação. Foram removidos a etapa de grupos, seus estados, ordenação por grupo, imports e estilos exclusivos. A sequência e a troca de exercícios pertencem à ficha; após o último exercício é possível revisar a mesma ficha.

Rotas preservadas: `/novo-treino` sem ficha ou com identificador malformado usa `replace` para `/treinar`. Apenas UUID de exercício e data de calendário válida atravessam a fronteira legada. Lembrete vencido mostra a data original, nunca “hoje”. Exercício fora da ficha não muda o contexto validado. Home offline, Histórico vazio, detalhes de exercício, aviso do layout e atalho PWA apontam para fichas. Router, lazy loading e links históricos continuam existentes.

A migration nova `20261126000001_sheet_only_reminder_entry.sql` muda exclusivamente o destino de novos lembretes para `/treinar?planejado=...`. Nenhuma migration histórica foi editada; agendamento, deduplicação e jobs não mudam. O teste de lembretes verifica a geração real desses links. Rollback: uma migration futura pode restaurar a definição anterior da função; nenhum job/notificação/histórico precisa ser apagado.

## Offline e integridade

Snapshots executáveis usam a store `syncMeta` existente, sob chave privada por usuário, schema v1, proprietário, revisão, instante de validação, exercícios ordenados e prescrições mínimas. Imagens/payloads de catálogo ficam de fora. Limite: 40 fichas, até 40 exercícios cada; validade: sete dias. Só leitura online autenticada para execução alimenta o cache. Metadados de usuário ativo e tombstone de logout impedem gravação tardia de outra sessão. A limpeza privada já existente remove snapshots no logout/troca de conta e preserva a outbox.

Cold start aceita apenas snapshot válido da conta local. A interface informa **“Dados salvos neste aparelho — validação pendente”**. Ausência/expiração/outro usuário não abre criação livre. Uma sessão validada já montada pode continuar se a rede cair mesmo quando o cache em disco falhar. Recusa online de autorização/execução deixa de usar o escopo anterior.

Registro usa a mesma outbox, compactação, idempotência e ACK existentes, sempre com `sheet_id` na criação. Recusa por ficha alterada/arquivada mantém séries, vínculo e mutação recuperável; detalhes/retry continuam na infraestrutura compartilhada. Não há segunda fila, alteração de recibos ou troca de vínculo para contornar recusa.

Conclusão continua exclusivamente online: revalidação de sessão, sincronização, dia do servidor e `complete_workout_sheet`. Marcações visuais agora distinguem usuário + ficha + dia e não importam a marcação legada ambígua. Não provam conclusão nem concedem moedas.

**Eliminado:** Treino Livre na UI e no novo fluxo. **Preservado:** leitura/edição de histórico sem ficha, inserts/replay de clientes antigos, receipts, outbox e `complete_workout_session` compartilhada pelo motor financeiro. Não foi aplicado NOT NULL nem bloqueio indiscriminado de inserts antigos. Um bloqueio futuro exige protocolo versionado e transição verificável para PWAs/filas antigos; esta entrega não inventa esse corte.

## Evidências executadas

- Suíte completa: 2.247 testes JS aprovados; após o último acréscimo, suites direcionadas e 16 interações do formulário aprovadas (incluindo o novo caso de revisão ao terminar a ficha). O CI do commit final é o gate definitivo.
- Scripts/release: 119 testes aprovados. Funções: 207 aprovados. Lint: zero erros; 16 warnings preexistentes.
- Banco descartável exclusivo: 174 migrations aplicadas e 3.382 asserções pgTAP aprovadas. A imagem local não inclui `pg_prove`: o adaptador via psql verificou todos os planos, contagens e resultados, falhando diante de qualquer `not ok`. CI mantém `supabase test db` sem relaxamento.
- Concorrência de moedas e atividade aprovada; evidências SQL de fichas/agregados e conclusão concorrente aprovadas. E2E financeiro real aprovado: navegador → Auth/PostgREST → PostgreSQL → ledger/carteira → saldo relido na UI.
- Browser de fichas: 320/360/390/768/1280 px, claro/escuro, CPU 4x, RTT 150 ms e 200 KB/s; sem overflow. Intenções legadas testadas em 320/360/390 px sem catálogo global. Home: 10 combinações e 120 casos de foto, sem erros.
- PWA: cold start com assets exclusivamente do SW, ficha salva, criação offline com `sheet_id` verificado na outbox, reconexão, atualização de SW; ausência de snapshot não abre formulário. IndexedDB/engine também cobrem expiração, conta diferente, logout, compactação/ACK e rejeição preservada.
- Login e cabeçalhos públicos: 256 verificações de browser aprovadas. Scanner de credenciais do build sem achados.
- Artefatos reproduzíveis em `docs/sheet-only-evidence/` e `docs/workout-sheets-evidence/sheet-entry-results.json`. Scripts de browser e novo cenário de entrada fazem parte do CI.

## Performance e limites

Comparação com a main usando as mesmas variáveis públicas, sem alterar thresholds (`bundle.json`): boot JS gzip 325.477 → 325.452 bytes; CSS 69.704 → 69.606 bytes; seis arquivos no grafo inicial em ambos. Todos os assets JS gzip somados: 885.203 → 887.177 bytes (cache/fluxo offline acrescentam código fora do boot). CSS total gzip: 84.161 → 84.068 bytes. Permanecem 156 chunks JS e 15 CSS. Budget aprovado.

Não se afirma ganho de tempo ou I/O: não foi feita comparação controlada antes/depois de requests em runtime. O smoke registra requests por cenário e confirma ausência de catálogo na execução. O precache PWA atual inclui 73 assets essenciais; gráficos continuam fora do install obrigatório.

Snapshots têm autorização histórica, não atual: alterações remotas podem ser recusadas no sync. Expiração exige reconectar para renovar o escopo. Marcações legadas locais permanecem compatíveis, mas não contaminam fichas. Armazenamento indisponível pode impedir cold start, preservando a sessão já aberta e as proteções da fila.

Os containers desta tarefa foram descartados ao terminar; containers/dados antigos foram preservados. A limpeza de imagens dispensáveis recuperou espaço: aproximadamente 2,2 GB → 5,3 GB livres em `/workspaces`. O preview 5173 aponta para a worktree atualizada, sem publicação em produção.

Busca estática final: referências restantes a Treino Livre pertencem aos prompts históricos preservados, ao relatório histórico explicitamente marcado, aos testes negativos e ao comentário de leitura de registros sem ficha. Não há CTA público de criação livre.
