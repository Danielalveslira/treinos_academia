// Limite de caracteres do TEXTO de uma publicação de comunidade. Precisa ser menor ou igual ao CHECK
// statuses_text_check do banco HOSPEDADO: editor, validador e rascunho usam esta constante, para o limite não
// divergir entre as camadas. Comentários e demais campos têm limites próprios.
//
// O limite do BANCO sobe para 7000 na migration 20261017000003_status_text_limit_7000.sql. Enquanto ela não
// estiver aplicada no projeto hospedado, o frontend publicado deve continuar em 500 (acima disso o banco
// recusa com o erro 23514). Depois de aplicar a migration, troque este valor para 7000 (uma linha); o teste
// statusLimits.test.js garante que o frontend nunca passe do que a migration mais recente permite.
//
// O JavaScript conta unidades UTF-16 (emoji = 2) e o banco conta caracteres (emoji = 1), então o limite do
// cliente é sempre igual ou mais estrito: nada que o formulário aceite é recusado pelo banco.
export const STATUS_TEXT_MAX_LENGTH = 500
