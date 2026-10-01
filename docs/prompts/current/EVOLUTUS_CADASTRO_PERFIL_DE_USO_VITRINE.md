# EVOLUTUS — Perfil de uso obrigatório no cadastro e acesso contextual à Vitrine

**Tipo:** especificação executável para Claude/Codex  
**Destino sugerido:** `docs/prompts/current/EVOLUTUS_CADASTRO_PERFIL_DE_USO_VITRINE.md`  
**Relação:** complementar `EVOLUTUS_VITRINE_AUTOPUBLICACAO_CANAL_UNICO_HOME.md`, sem substituir suas regras de autopublicação, canal único e Home.

## Objetivo

No cadastro, o usuário declara **obrigatoriamente** como pretende usar o Evolutus. Essa escolha personaliza as opções exibidas, sem presumir habilitação profissional ou criar permissões administrativas. Implementar de ponta a ponta e remover condicionais antigas que conflitem com o novo fluxo.

## 1. Campo obrigatório no cadastro

Exibir pergunta clara: **“Como você pretende utilizar o Evolutus?”**, com seleção única, sem alternativa pré-selecionada:

- **Usuário comum** — treinar, acompanhar progresso e participar das comunidades.
- **Profissional** — personal trainer ou outro profissional da área.
- **Responsável por estabelecimento** — academia, estúdio ou espaço de prática física.

Validar o preenchimento no frontend **e** no backend. Persistir a escolha no perfil do usuário em campo próprio e tipado, distinto de `role`/permissões administrativas e do `type` da Vitrine. Reutilizar convenções reais do repositório; não criar propriedades concorrentes nem confiar em campos enviados pelo cliente para elevar privilégios. A escolha é autodeclarada e não constitui verificação de credenciais.

## 2. Regras de acesso e navegação

| Perfil de uso | Treinos e comunidades | Consultar diretório público | Criar/gerenciar Vitrine |
| --- | --- | --- | --- |
| Usuário comum | Sim | Sim | Não exibir opção de criação; rejeitar criação também no backend |
| Profissional | Sim | Sim | Mostrar as opções **Profissional** e **Estabelecimento** |
| Responsável por estabelecimento | Sim | Sim | Mostrar as opções **Profissional** e **Estabelecimento** |

Um profissional também pode empreender, e um responsável por estabelecimento também pode atuar como profissional. **A escolha no cadastro não restringe o tipo da Vitrine.** Ela apenas determina se os recursos de criação comercial ficam disponíveis.

Preservar a regra atual: **no máximo uma Vitrine total por conta**, independentemente de tipo. Não permitir criar uma segunda Vitrine ao alternar o perfil de uso ou o tipo da Vitrine. Quem já possui Vitrine deve ver **“Minha Vitrine”** e administrar a existente, não outro botão de criação. Não reintroduzir aprovação prévia de superadmin; manter moderação posterior e canal único de atendimento/denúncias conforme especificação principal.

## 3. Alteração posterior e contas existentes

- Permitir alterar o perfil de uso em **Meu Perfil/Configurações**, com texto objetivo sobre o efeito na interface. Usuário comum que passar a profissional ou responsável por estabelecimento poderá criar sua Vitrine.
- Ao tentar mudar para **Usuário comum** tendo uma Vitrine existente, não apagar, despublicar nem ocultar silenciosamente a Vitrine. Solicitar que o titular a gerencie explicitamente antes de concluir a mudança, com mensagem e ações claras. Respeitar suspensão, exclusão e demais estados já existentes.
- Para contas legadas sem o campo, oferecer preenchimento contextual na próxima visita ao perfil ou ao fluxo de Vitrine; não classificá-las automaticamente como usuários comuns, não bloquear todo o aplicativo e não retirar acesso de quem já possui Vitrine. A migração deve ser segura e idempotente.
- Não migrar dados em massa nem publicar/despublicar Vitrines sem ação explícita do titular.

## 4. Implementação técnica e limpeza

Investigue o fluxo real de registro, criação de perfil, alterações de perfil, navegação, Home e serviços/Rules da Vitrine. Faça a menor alteração coesa para persistir e validar o perfil de uso, inclusive em chamadas diretas à Function. Centralize as condições de visibilidade para evitar divergência entre desktop/mobile. Não confundir a declaração do usuário com `superadmin`, com moderação ou com a autorização específica de avatar. Preserve o aceite jurídico vigente, a projeção pública sanitizada e a regra transacional de uma Vitrine por UID. Remova estados, botões, condicionais e testes antigos que se tornarem comprovadamente obsoletos; não remova código compartilhado.

Se a nova coleta exigir ajuste nos documentos jurídicos, **prepare minuta versionada para aprovação humana**, sem alterar versões imutáveis nem publicar documentos nesta tarefa.

## 5. Testes e aceite

Cobrir: cadastro sem seleção rejeitado; cada uma das três opções persistida; usuário comum sem CTA e impedido de criar por chamada direta; profissional/responsável podem escolher qualquer um dos dois tipos de Vitrine; uma Vitrine/UID mesmo após troca de perfil e em concorrência; atualização do perfil refletida na navegação; contas legadas e com Vitrine preservadas; alteração para comum com Vitrine existente não provoca perda automática; acesso público ao diretório e permissões administrativas permanecem corretos. Verificar desktop/mobile, testes pertinentes de frontend, Functions e Rules/Storage, lint, build e `git diff --check`.

## 6. Entrega

Trabalhar em branch a partir da `main` atualizada **ou da branch ativa da especificação principal**, sem duplicar trabalho. Fazer commits organizados e push ao origin; preservar `docs/prompts/` e mudanças não relacionadas. **Não fazer merge na `main`, deploy Firebase/Vercel, publicação jurídica nem mutação de dados de produção.** Não alterar EvoCash, ledger, preços ou IAM fora de necessidade comprovada. Informar branch, SHA, arquivos alterados, decisões de compatibilidade, testes, eventual pendência jurídica e passos de rollout. Depois parar.

**Pronto quando:** todo novo usuário escolhe um perfil de uso; usuário comum usa normalmente o app sem opção comercial; os outros dois perfis podem criar/gerenciar uma Vitrine de qualquer tipo, respeitado o limite de uma por conta; contas existentes e direitos sobre seus dados são preservados.
