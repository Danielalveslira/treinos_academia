# Performance e escalabilidade

Medições reais locais, com dados sintéticos e rollback. Não são SLA, teste de carga de produção ou estimativa de capacidade hospedada. Nenhum teste pesado remoto foi executado.

## Comparações reproduzidas

| Consulta | Massa e amostragem | Antes | Depois | Interpretação |
| --- | --- | --- | --- | --- |
| Comunidades com elegibilidade paga | 2.000 comunidades, 200 retornadas; EXPLAIN ANALYZE/BUFFERS | 2.818,253 ms | 32,115 ms | Compara gate por linha com gate por consulta; elegibilidade paga executada uma vez. Uma medição, não p50/p95. |
| Seleção publicitária | 10.000 anúncios históricos expirados; 20 amostras por variante | p50 13,3815 ms; p95 41,0567 ms | p50 12,6300 ms; p95 18,38165 ms | Compara ausência/presença do índice de expiração já incorporado na Fase 6. Ganho anterior preservado; não atribuído a índice novo desta consolidação. |

Planos e resultados em `community-performance.json`, `performance-10000.log`, `advertising-performance.log`. Harnesses `phase6-community-performance.mjs` e `phase6-performance.mjs 10000`; auto_explain registra consultas aninhadas com buffers. Os ensaios ocorreram com atividade de homologação local, portanto há variação e interferência de carga.

## Melhorias efetivas desta etapa

Removida uma consulta inicial redundante a comunidades destacadas. Seleção e invalidação permanecem separadas de carteira/ledger. Recuperação de canal adiciona no máximo três revalidações por interrupção, sem consulta financeira, por escopo/hook montado; cinco segundos é limite técnico da decisão durante falha, não extensão de contrato nem garantia de disponibilidade. Eventos de foco/erro não reabastecem orçamento. Reconexão obtém decisão nova.

Commit protegido impede trabalho obsoleto de substituir o estado atual. As listas e centrais preservam paginação/cursor e lazy loading. Não se adicionou dependência, cache de autorização, polling contínuo, índice especulativo ou reestruturação de bundle sem medição que justificasse.

O diagnóstico de catálogo não encontrou índices equivalentes duplicados. Foram preservados índices de histórico por usuário/data, recursos/ordens, vigência/reservas e proprietário/tipo/UUID; constraints/FKs permanecem. O epoch global ainda serializa invalidações, devendo ser medido no volume hospedado antes de ampliar inventário.

## Frontend e demais fluxos

Build de produção, budget e scanners foram executados novamente. O budget inicial mediu boot JS gzip 320.749 bytes, CSS gzip 75.572 bytes, seis arquivos; o resultado final está em `budget-final.log`. O chunk Primer mantém o aviso herdado acima de 500 kB; não se aumentou o limite para ocultá-lo. Os 14 warnings de lint anteriores permanecem documentados.

As 78 combinações de rotas/tamanhos/temas verificam conteúdo carregado, overflow, HTTP e exceções. São verificação funcional/responsiva, não uma medição Lighthouse/CLS ou em aparelho fraco real. Não foram inventados números de Web Vitals.

Perfis/estabelecimentos, catálogos, mídia, cotação e histórico mantêm as medições detalhadas das Fases 4.1/5.1 e regressões atuais. Não se atribui ganho novo a esses fluxos e não se afirma nova amostragem p50/p95 de cada um. Renovação/checkout/upload foram exercitados funcionalmente via SQL/HTTP/browser; latência local de cada clique não representa capacidade de produção. Validar carga, cold start, Storage/CDN e dispositivos reais permanece item externo de lançamento.

## Amostragem de rotação

`consolidation-rotation.mjs` executou 500 seleções reais por superfície, em transação read-only, sem gravar eventos/contagens de audiência. Na Home havia sete campanhas observadas: primeira posição 58, 73, 73, 71, 89, 68 e 68 vezes (500 no total). Nas duas posições da comunidade havia uma campanha elegível, selecionada nas 500 chamadas de cada superfície. A amostra com quantidades diferentes não indicou desequilíbrio que justificasse trocar o `ORDER BY random()` simétrico por um algoritmo novo. Não é garantia estatística de igualdade ou entrega mínima; resultados em `rotation.json`.
