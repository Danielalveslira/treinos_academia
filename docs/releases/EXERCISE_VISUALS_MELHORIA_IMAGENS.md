# Imagens de exercícios — publicação autorizada em andamento

Destinos confirmados: GitHub Danielalveslira/treinos_academia, conta Danielalveslira, branch main; Supabase ywrjojrjgozdfpddkkuy ACTIVE_HEALTHY; Vercel treinos_academia, prj_WYVlCGYu021KZCrqfp62qRH2cbIE, equipe danielalvesliras-projects.

Migration 20261029000001_exercise_visual_deletion aplicada isoladamente pela CLI após dry-run: journal 129 → 130. RLS, política exclusiva de superadmin, grants mínimos, nove fences e preservação integral de estilos/referências existentes confirmados. Edge delete-exercise-visual v1 e cleanup-exercise-visuals v2 ACTIVE, verify_jwt=true. Não foi executada limpeza histórica.

Validação repetida nesta publicação: 1.910 JavaScript; 151 Edge/um skip preexistente; 307 SQL; 18 verificações de integração local; quatro casos de navegador mobile/desktop claro/escuro. Lint zero erros/14 avisos preexistentes e build aprovado. A primeira integração encontrou 502 durante inicialização do Storage local; a repetição após readiness passou integralmente.

Frontend: commit/push e READY serão confirmados após esta etapa. Smoke real autorizado usará imagens V2 já publicadas do mesmo exercício para aprovação, seguido de restauração da versão original. A versão aprovada permanecerá protegida no histórico. Somente uma segunda versão nunca publicada, criada explicitamente para descarte, poderá ser excluída. Sem novos usuários, mudança de senha, envio de e-mail, mudança de estilo, exclusão antiga ou operação financeira.

## Diagnóstico e prompts

O perfil V2 já exigia neutralidade, mas o builder dependia de descrições genéricas do avatar e de poses (“começo/fim da repetição”). Muitas instruções do catálogo terminam com retorno a START; chamar esse retorno de END favorecia poses iguais. A referência START era obrigatória apenas no texto: FINAL podia ser copiado sem confirmar sua disponibilidade. A geração é manual e externa; não há detector de paisagem ou avaliação automática de biomecânica.

Prompt `v2.1`, preservando perfil/style `EVOLUTUS_FITNESS_V2`: adulto andrógino com rosto, cabelo, proporções, tom de pele e roupa explicitados, corpo/equipamento completos, uma única pose, transparência e proibição de cenário/paisagem/texto/colagem. START deriva do preparo descrito; END usa o deslocamento seguinte, antes do retorno. Câmera escolhida pela direção descrita e mantida no END. Catálogo insuficiente orienta esclarecimento e bloqueia cópia para geração; não inventa equipamento ausente. FINAL depende de START selecionado ou confirmação explícita de que será anexado. Formatos Genérico/Gemini/ChatGPT e proveniência/hash permanecem.

Exemplo, supino do catálogo: **antes**, “começo da repetição” / “fim da repetição”; **depois**, START deitado no banco com barra acima do corpo e braços estendidos, END descendo a barra até o meio do peito, mantendo o START anexado como referência. Nenhum ângulo ou apoio ausente foi fabricado.

Cinco casos reais, corroborados por leitura do catálogo de produção: flexão, butterfly, supino com barra, rosca martelo com halteres e panturrilha no leg press (movimento sutil). Todos os prompts ficaram menores. Exemplos completos em `/tmp/exercise-visual-tests/prompt-samples.json`. A validação foi textual e de fluxo; não houve geração em IAs externas nem promessa de controle absoluto sobre seus resultados. As imagens dos testes de navegador são fixtures sintéticas. Os screenshots citados no pedido não foram anexados à conversa.

## Revisão, exclusão e performance

START/END maiores, miniatura comparável, zoom acessível e prévia dos arquivos antes do upload. Dez checkboxes viraram uma confirmação humana única; a publicação também exige arquivos abertos e metadados válidos. Formato/dimensões/presença são verificáveis; exercício, identidade, equipamento e compatibilidade da miniatura são inspecionados pelo revisor. Rejeição tem seis motivos rápidos e observação opcional; mantém histórico. Exclusão tem confirmação própria e lixeira discreta; versões usadas em publicação/rollback são protegidas.

Uma fila específica foi necessária: a outbox anterior só aceita fotos de publicações e avatares. A RPC exclusiva de superadmin revalida status, versão ativa, todas as fontes de mídia do catálogo, referências de estilo e outros registros que guardam URLs, com locks do exercício e dos arquivos. Remove versão e assets próprios na transação; conserva auditoria, perfis e recibo mínimo de exclusão. O worker remove os seis paths canônicos possíveis (rascunhos e cópias parciais de publicação), confirma ausência e só então marca conclusão. Falha permanece pendente, visível no Histórico, com reprocessamento; a limpeza administrativa existente também drena essas tarefas. Leases, tokens e tombstones impedem confirmação velha, cópia tardia, referências novas e reutilização de versão/path. Retry de um upload já descartado exige nova chave. Resposta perdida revalida o estado; se essa leitura falhar, a revisão é bloqueada até “Recarregar versões”.

Histórico e seus arquivos só entram ao abrir; URLs privadas são assinadas em lote e reutilizadas durante sua validade. Rejeição, upload e exclusão deixam de reler catálogo/cobertura; ações atualizam os conjuntos em segundo plano, mantendo seleção e sem spinner que desmonta a revisão. Existe uma leitura adicional necessária das pendências de exclusão. Sem novas dependências ou timers. Imagens em revisão têm prioridade; o catálogo mantém lazy loading.

## Arquivos e validação

- Builder/testes: `src/utils/exerciseVisualPromptBuilder*`, `exerciseVisualReview*`.
- UI/estado/serviço: `src/components/exerciseVisuals/*`, `CopyButton.jsx`, `ExerciseCatalogImage.jsx`, `src/hooks/useAdminExerciseVisuals.js`, `src/services/exerciseVisualsService*`, `src/pages/AdminExerciseVisuals.test.js`, `src/styles/app.css`.
- Backend: `supabase/migrations/20261029000001_exercise_visual_deletion.sql`, `supabase/functions/delete-exercise-visual/*`, `cleanup-exercise-visuals/*`, `_shared/edgeTestKit.js`, `supabase/config.toml`.
- SQL: `exercise_visual_deletion_test.sql` e adequação dos testes V1/V2 aos bloqueios atuais de Storage/anon, sem ampliar privilégios.
- Scripts reproduzíveis: `verify-exercise-visual-prompts.mjs`, `verify-exercise-visual-deletion-local.mjs`, `verify-exercise-visuals-browser.mjs` e `exercise-visual-test-fixtures.mjs`. Requerem Chromium instalado; a integração exige a stack local com `cron.launch_active_jobs=off` e a migration aplicada. As fixtures sintéticas são geradas sob demanda em `/tmp`.

1.910 testes JavaScript; 151 Edge Functions aprovados e um skip preexistente; 307 assertions pgTAP (95 V1, 175 V2, 37 exclusão); 18 verificações de integração real. Cobertura: upload WebP, confirmação/publicação, comum/anon sem permissão, versão publicada/arquivada/ativa bloqueada, referências compartilhadas e legadas, Storage indisponível, repetição, remoção física, publicação versus exclusão e referência concorrente. Navegador: 390/1366 px, claro/escuro, comparação antes/depois, zoom, aprovação deliberada, upload com prévia, rejeição de paisagem, pendência e retry; zero page errors, sem overflow, seleção preservada e uma única navegação de documento. Lint zero erros/14 avisos preexistentes; build e formatação aprovados.

## Publicação e recuperação

A autorização posterior do responsável permite aplicar banco/funções e publicar o frontend. Migração realizada com `db push --linked --project-ref ywrjojrjgozdfpddkkuy --workdir /tmp/exercise-publish/release-package --skip-vault --yes`; somente a versão 20261029000001, sem seed, roles, repair ou configuração de secrets. Funções publicadas nominalmente com `--use-api`; autenticação preservada.

Na limpeza em produção, o endpoint legado será consultado somente com `dryRun:true`. Exclusão real ocorrerá exclusivamente pelo endpoint específico e ID descartável. Em falha de Storage, preservar fila/tombstones e reprocessar; nunca declarar conclusão prematura nem remover fences. Frontend pode voltar ao deployment anterior compatível; não apagar a fila para reverter uma exclusão física.

A remoção física usa a Storage API, com confirmação de ausência. Artefatos operacionais e credenciais temporárias ficam exclusivamente em /tmp, fora do commit. Evidências finais de commit, READY e smoke serão atualizadas no workspace depois da publicação, sem gerar um deploy adicional apenas para documentar o resultado.
