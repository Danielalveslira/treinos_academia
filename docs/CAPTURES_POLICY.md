# Capturas de validação

Capturas de tela de testes e revisões não devem ser versionadas nem enviadas no código de deployment. As capturas históricas foram removidas da árvore atual do repositório, sem reescrever o histórico Git. Os relatórios técnicos em texto foram preservados.

`.gitignore` impede novo versionamento de imagens documentais. `.vercelignore` exclui essas imagens e diretórios locais de evidência dos uploads da CLI. As verificações de navegador da Home passam a registrar somente dados de validação, sem salvar prints.

As quatro imagens em `docs/banner-sources/` são artes-fonte utilizadas por `scripts/optimize-public-banners.mjs` para gerar banners reais em `public/img/banners/`; não são capturas de QA e foram preservadas. Assets em `public/` e `imports/` também foram preservados.
