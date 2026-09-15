# Imagens do catálogo de exercícios

## Origem

Os caminhos `imageRefs` vêm do dataset traduzido
[`joao-gugel/exercicios-bd-ptbr`](https://github.com/joao-gugel/exercicios-bd-ptbr), que
preserva referências do projeto original
[`yuhonas/free-exercise-db`](https://github.com/yuhonas/free-exercise-db).

O pipeline local usa, por padrão, somente para importação:

```text
https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/
```

O aplicativo nunca usa o GitHub em runtime. A origem pode ser alterada localmente com
`EXERCISE_CATALOG_IMAGE_SOURCE_BASE_URL`.

Durante `npm run dev`, o Vite serve os arquivos já processados em `.generated` pela URL
local `/exercise-catalog-assets/v1`. Execute `npm run build:catalog-images:apply` antes de
abrir o catálogo. Builds de produção não incluem nem servem esse diretório.

## Licença e produção

O projeto original declara Unlicense para o repositório. Entretanto, o projeto traduzido
informa que não redistribui os binários por não possuir confirmação de permissão, e existem
discussões abertas sobre a origem específica das imagens.

Não executar upload de produção até documentar explicitamente a permissão de uso e
redistribuição dos binários.

## Pipeline local

```bash
npm run build:catalog-images:dry-run
npm run build:catalog-images:apply
```

O modo `--dry-run` não baixa nem grava arquivos. O modo `--apply` gera arquivos em:

```text
.generated/exercise-catalog-images/v1/<exerciseId>/thumb.webp
.generated/exercise-catalog-images/v1/<exerciseId>/0.webp
.generated/exercise-catalog-images/v1/<exerciseId>/1.webp
```

Esse diretório não é versionado.

## Upload explícito

O uploader requer Application Default Credentials e bucket explícito:

```bash
node scripts/upload-exercise-catalog-images.mjs --dry-run --bucket <bucket>
node scripts/upload-exercise-catalog-images.mjs --apply --bucket <bucket>
```

O upload não cria documentos Firestore. Os objetos recebem `image/webp` e
`public,max-age=31536000,immutable`.

## URL do aplicativo

Configure uma única variável:

```text
VITE_EXERCISE_CATALOG_ASSET_BASE_URL
```

Para CDN, use a raiz versionada, por exemplo:

```text
https://cdn.example.com/exercise-catalog/v1
```

Para o endpoint REST determinístico do Firebase Storage:

```text
https://firebasestorage.googleapis.com/v0/b/<bucket>/o
```
