# Auditoria final — cadastro exclusivo para maiores de 18 anos e padronização da marca Evolutus

## Contexto

Projeto: `Danielalveslira/treinos_academia`.
PR em andamento: [#113](https://github.com/Danielalveslira/treinos_academia/pull/113), branch `feat/juridico-auditoria-20261102`, inicialmente atualizada até o commit `c7f6fe59e2dcc869feb1bd8894ce5e6ec9a02996` (confirme o HEAD antes de trabalhar).

**Decisão de produto definitiva para este escopo:** o Evolutus só admite **novos cadastros de pessoas com 18 anos completos ou mais**. Nos documentos legais novos, o nome da plataforma é **Evolutus**, nunca a marca antiga **Treinos/Treino**. A palavra comum **treino/treinos**, quando designa atividade física, deve permanecer.

Há uma implantação jurídica maior no PR #113 (aceites, histórico imutável, consentimento de saúde e termos comerciais). **Não descaracterizar nem regredir essas correções.** As versões jurídicas já publicadas são registros históricos imutáveis; a versão geral `2.0.0` e os documentos comerciais ainda são **minutas**.

## Objetivo

Faça uma **auditoria de ponta a ponta** da implementação 18+ e da atualização de marca. Investigue o código real antes de concluir que algo está correto. Identifique falhas, valide comportamentos com testes direcionados e corrija apenas problemas comprovados dentro do escopo. Produza um relatório objetivo, com evidências por arquivo/função, e declare explicitamente o que não pôde ser verificado.

## Regras de execução e segurança

1. Trabalhe na branch do PR #113 ou numa worktree isolada dela. **Não modifique a pasta principal com alterações locais do proprietário.** Leia `git status`, confira HEAD, base e diff. Não sobrescreva trabalho existente.
2. **Não faça merge, deploy, push de migrations, publicação/ativação de documentos, ativação de vendas nem alteração no banco de produção.** Não use as credenciais de produção para testes.
3. Se precisar testar SQL, use um **Supabase local isolado**, criado para esse fim. Não execute reset no banco local do proprietário.
4. Preserve dados, registros financeiros, aceites, hashes e versões jurídicas históricas. Migrações devem ser seguras e aditivas. Sem limpeza automática de usuários.
5. Faça alterações somente se identificar defeitos reais. Evite refatoração incidental, novos fluxos desnecessários ou testes repetidos sem utilidade. Se corrigir algo, prepare commit(s) na branch do PR; não altere o estado draft.

## 1. Auditoria do cadastro 18+

Rastreie **todos** os caminhos de criação e conclusão da conta, do cliente ao servidor:

- `/cadastro`, formulário em três etapas, validação de data, envio do `signUp`, confirmação de e-mail e retomadas após interrupção.
- `ProfileCompletionForm`, `ProfileCompletionGate`, `completeUserProfile`, `setBirthInfo`, eventual cadastro alternativo e todos os chamadores que escrevem nascimento ou concluem perfil.
- `LegalGate`, `accept_legal_documents`, `legal_policy.minimum_age`, manifesto jurídico antigo e novo, `has_app_access` e regras de contas parcialmente criadas.
- Caminhos diretos por Supabase Auth/PostgREST/RPC, inclusive ignorando a UI, cliente desatualizado, requisições duplicadas, usuários sem nascimento e tentativas de trocar a data depois do cadastro.

**Critérios obrigatórios:**

- Nascimento exatamente no dia do 18º aniversário: **aceito**; um dia mais novo: **recusado**. Verifique virada de ano, dia 29/02, datas inexistentes, futuro, idade implausível e fuso `America/Sao_Paulo`.
- Cadastro de 16/17 anos **não pode se tornar uma conta utilizável** pelo app nem ter acesso indevido por API; validação visual sozinha não é suficiente.
- Identifique se `supabase.auth.signUp` pode criar a identidade **antes** de o backend receber a data de nascimento. Se sim, descreva claramente essa limitação e garanta bloqueio de uso até validação server-side. Avalie a necessidade/viabilidade de bloqueio antecipado **sem inventar garantias impossíveis de verificação de identidade** e sem prejudicar confirmação de e-mail, recuperação de cadastro ou autenticação existente.
- O backend deve aplicar `18+` independentemente de a versão jurídica histórica `1.5.0` ainda declarar `12`. Não basta alterar texto no frontend.
- Não deve haver bypass por campos nulos, atualização direta, versão antiga do app, conta incompleta ou sessão revogada.
- Trate contas preexistentes eventualmente pertencentes a menores **sem apagar registros ou negar automaticamente atendimento, privacidade e outros direitos legais**; documente a política de transição ainda necessária.
- Exiba erro curto e compreensível ao usuário no campo de nascimento: **“É necessário ter pelo menos 18 anos para se cadastrar.”** Nenhuma falsa promessa de verificação documental de idade.

## 2. Revise as implementações recentes (não presuma que estejam corretas)

Confira especialmente:

- `src/constants/accountAge.js`
- `src/pages/Register.jsx` e `src/pages/Register.test.js`
- `src/components/ProfileCompletionForm.jsx`, `src/components/LegalGate.jsx`
- `src/utils/validators.js`, `src/utils/age.js`, `src/utils/registrationErrors.js`
- `supabase/migrations/20261212000001_legal_acceptance_integrity.sql`
- `supabase/migrations/20261212000004_adult_only_registration.sql` e seu rollback
- `supabase/tests/legal_acceptance_integrity_test.sql`, `supabase/tests/residence_municipality_test.sql`

Analise sintaxe SQL real, quoting de strings e dollar quotes, `search_path`, privilégios `EXECUTE`, RLS, proteção de sessão revogada, compatibilidade da RPC `set_birth_info(jsonb)` com seus chamadores, ordem de triggers/migrations e preservação das regras antigas do cadastro. **Não trate aprovação anterior de CI como prova para o HEAD atual.**

Verifique também se a função `calculateAge` do frontend usa o mesmo dia civil e a mesma regra de aniversário do backend. Não introduza divergência por UTC ou timezone do aparelho. Identifique e corrija duplicação ou inconsistência da constante de idade.

## 3. Auditoria da marca nos documentos jurídicos

Leia integralmente os documentos em `legal/drafts/`, os textos ativos em `legal/` e os pontos onde são exibidos (rotas jurídicas, formulário de cadastro, resumo de aceites, links, páginas de vitrine e termos comerciais).

- Toda **nova minuta** deve identificar a plataforma como **Evolutus**, incluindo textos, títulos, resumos, referências institucionais e descrições.
- Não substitua mecanicamente `treino`/`treinos` quando significarem exercício, ficha, rotina ou treinamento físico.
- **Não altere** o conteúdo nem o digest de versões `1.x` já publicadas para trocar a marca: mantenha o histórico comprovável. A correção da marca deve valer nos novos documentos após aprovação e publicação da nova versão.
- Confirme que `general-2.0.0.manifest.json` tem `minimumAge: 18` e que Termos de Uso, Política de Privacidade, Regras da Comunidade e os quatro termos comerciais não afirmam que menores podem se cadastrar.
- Elimine contradições entre “contas apenas 18+”, regras de compras, moderação, publicidade e privacidade. Menções a proteção contra exploração de menores podem permanecer; não confundir elegibilidade de cadastro com moderação de conteúdo.
- Preserve `published: false`, `approved: false` e datas pendentes das minutas. **Não atualize `approved-digests.json` nem ative `legal_policy` sem aprovação humana.**
- Registre pendências jurídicas de conteúdo sem inventar identificação do controlador, CNPJ, base legal, política de reembolso ou retenção ainda não definidos.

## 4. Testes de aceitação obrigatórios

Execute apenas os testes necessários para demonstrar o comportamento novo e evitar regressão:

1. Testes unitários de data de nascimento: 17 anos, exatamente 18, 18+, aniversário amanhã/hoje, ano bissexto, datas inválidas e comportamento de fuso.
2. Testes do cadastro: menor é rejeitado **antes do envio normal de `registerUser`**, adulto completa o fluxo, consentimento de saúde permanece opcional e o erro aponta para o campo correto.
3. Teste de retomada de perfil: menor bloqueado; adulto com dados válidos continua; interrupção, recarga e sessões revogadas não abrem bypass.
4. Testes pgTAP/RPC com usuário autenticado e chamadas diretas: `set_birth_info`, `accept_legal_documents`, políticas antigas de idade 12, sessão revogada, nascimento nulo, registros históricos inalterados. Confira o retorno e o estado persistido, não apenas a mensagem de erro.
5. Teste de integridade das minutas: idade `18`, marca correta, nenhuma publicação/alteração de digest.
6. Lint, build e testes de CI relacionados às partes alteradas. Depois, confira todos os jobs exigidos pela CI **no último commit**. Reporte bloqueios separadamente; nunca declare testes não executados como aprovados.

Se algum teste falhar, encontre a causa, corrija, reexecute o conjunto afetado e indique a evidência. Inclua os novos testes no repositório, sem criar testes redundantes.

## 5. Resultado esperado

Entregue um **relatório final curto e verificável** com:

- **Status por camada:** interface, cadastro/retomada, autenticação, RPCs, RLS/sessão, documentos, histórico/versões e testes.
- **Problemas encontrados:** gravidade, arquivo/função, impacto, correção executada ou pendência explícita.
- **Evidências:** comandos/testes executados e resultados, incluindo o estado do CI do HEAD.
- **Mudanças realizadas:** arquivos, migrations, commits (se houver), sem alterações alheias ao escopo.
- **Riscos residuais:** identidade Supabase criada antes da validação, contas preexistentes, decisões jurídicas ainda abertas.
- **Veredito:** `APTO PARA REVISÃO`, `PRECISA DE CORREÇÕES` ou `BLOQUEADO`, com justificativa objetiva.

**Importante:** mantenha o PR #113 em rascunho. A aprovação jurídica das minutas, o merge e qualquer implantação serão decisões posteriores e separadas.
