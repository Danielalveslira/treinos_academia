# Cadastro em 3 etapas e "Cidade onde mora" (IBGE)

## Visão geral

- **Cadastro** (`src/pages/Register.jsx`): 3 etapas na mesma rota — *Sua conta* (usuário, e-mail,
  senha), *Sobre você* (nascimento, cidade, sexo) e *Finalizar* (perfil de uso, consentimentos). A
  conta só é criada na etapa 3; confirmação por código (OTP) e o failsafe de senha não mudaram.
- **Cidade**: `CitySelector` (combobox acessível) busca localmente no catálogo estático
  `src/data/ibgeMunicipalities.js` (chunk próprio, carregado sob demanda). Nenhuma chamada ao IBGE
  durante o uso. O valor salvo é sempre o **código IBGE**.
- **Servidor** (`supabase/migrations/20261209000001_residence_municipality.sql`):
  - `public.ibge_municipalities` — catálogo de referência (sem acesso pelos papéis da API).
  - `public.users.residence_municipality_code` — nullable, FK para o catálogo (código inexistente é
    recusado pelo próprio banco). Privado: só o titular lê (policy `users_select`); não vai para
    `public_profiles`.
  - `public.set_residence_municipality(code)` — única escrita; `auth.uid()` + conta em situação
    regular; `INVALID_MUNICIPALITY` para código fora do catálogo; idempotente.
  - `public.set_birth_info` — quando a chave `sexo` é enviada, ela precisa ser uma das opções
    (`INVALID_SEXO`). Sem a chave (LegalGate de contas antigas), nada muda.
- **Contas antigas**: não são bloqueadas nem alteradas. A cidade é sugerida em Meu Perfil →
  "Cidade onde mora". O `ProfileCompletionGate` só aparece para contas sem `username` (cadastro
  interrompido) e então pede cidade e sexo, reaproveitando o que já foi salvo.

## Atualizar o catálogo de municípios

Rotina manual (não há cron). Requer Node 20+ e acesso à internet.

```bash
# 1) Baixa, valida e mostra o diff — não grava nada
node scripts/update-ibge-municipalities.mjs

# 2) Grava o catálogo do frontend E gera a migration de upsert do servidor
node scripts/update-ibge-municipalities.mjs --write --migration

# 3) Confere a consistência frontend × servidor e o gerador
node --test scripts/ibge-municipalities-core.test.mjs
```

O teste de consistência compara o catálogo do frontend com o seed da migration
`20261209000001`. Depois de uma atualização, ajuste esse teste para também ler a migration
`*_ibge_municipalities_refresh.sql` mais recente.

Validações feitas antes de gravar (qualquer falha = nada é gravado; a escrita é atômica):

- 27 UFs; quantidade de municípios entre 5.500 e 6.000;
- código inteiro de 7 dígitos com prefixo de UF conhecido;
- UF aninhada na resposta (`microrregiao` ou `regiao-imediata`, uma delas pode vir `null`) igual à do prefixo;
- sem código duplicado e sem nome repetido na mesma UF;
- **nenhum código removido** em relação ao catálogo atual (use `--allow-removals` só depois de
  revisar; a FK `on delete restrict` impede apagar um código ainda usado por alguma conta).

Ordem de publicação: **aplicar a migration de refresh antes** de publicar o frontend com o catálogo
novo — senão uma cidade recém-criada seria recusada (`INVALID_MUNICIPALITY`).

Para trabalhar offline, salve as respostas e use `--from <dir>` (com `municipios.json` e `estados.json`).

## Publicação desta entrega

1. Aplicar `20261209000001_residence_municipality.sql` em produção **antes** do frontend.
   O cadastro novo chama `set_residence_municipality`; sem a migration, todo cadastro novo
   ficaria com o perfil incompleto.
2. Conferir `npx supabase migration list` e `npx supabase db push --dry-run`: a lista pendente deve
   conter **apenas** esta migration. Se aparecer outra, não use `--include-all`; resolva a ordem antes.
3. Publicar o frontend.
