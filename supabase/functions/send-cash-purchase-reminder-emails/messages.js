// Template HTML fornecido pelo usuário (email-compra-pendente-v2.html, feito no editor do
// Resend). Reproduzido aqui como string, com os placeholders {{{...}}} substituídos por
// valor real já escapado -- nenhum dado dinâmico (username, nome do pacote) chega ao HTML
// sem passar por escapeHtml antes, mesmo vindo de um admin autorizado: um username ou rótulo
// de pacote com caracteres de marcação nunca deve injetar HTML num e-mail enviado em nome do
// usuário. Versão texto simples é obrigatória junto (client req.) e listada abaixo, com os
// MESMOS dados, nunca um resumo diferente do que o HTML mostra.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatBRL(amountCentavos) {
  const value = (Number(amountCentavos) || 0) / 100
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatDateBR(isoDate) {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const HTML_TEMPLATE = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1" name="viewport" />
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta content="IE=edge" http-equiv="X-UA-Compatible" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <meta content="telephone=no,address=no,email=no,date=no,url=no" name="format-detection" />
    <title>Sua compra de EvoCash está pendente</title>
    <style>
      body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
      img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
      a { text-decoration: none; }
      @media only screen and (max-width: 620px) {
        .wrap { padding: 16px 8px !important; }
        .px { padding-left: 24px !important; padding-right: 24px !important; }
        .btn { display: block !important; }
      }
    </style>
  </head>
  <body dir="ltr" lang="pt-BR" style="margin:0;padding:0;background-color:#f6f7f9;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
      Finalize o pagamento do plano __PLANO__ e receba seus __EVOCASH__ EvoCash.&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>

    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f6f7f9;">
      <tr>
        <td class="wrap" align="center" style="padding:40px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

          <table border="0" width="560" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:560px;background-color:#ffffff;border-radius:16px;">

            <!-- Marca -->
            <tr>
              <td class="px" style="padding:36px 40px 0 40px;">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                  <tr>
                    <td valign="middle" style="padding-right:10px;">
                      <img alt="" width="36" height="36" src="https://resend-attachments.s3.amazonaws.com/pdDtF6c9lOG8xW0G7jsmz-/e178a7aa-0a5d-4b72-b1e1-c08acb5f16cb" style="display:block;width:36px;height:36px;border-radius:8px;" />
                    </td>
                    <td valign="middle" style="font-size:18px;line-height:36px;font-weight:700;letter-spacing:-0.01em;color:#0b0e14;">Evolutus</td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Título e texto -->
            <tr>
              <td class="px" style="padding:32px 40px 0 40px;">
                <h1 style="margin:0;font-size:26px;line-height:34px;font-weight:700;letter-spacing:-0.02em;color:#0b0e14;">Sua compra de EvoCash está pendente</h1>
                <p style="margin:14px 0 0 0;font-size:16px;line-height:26px;color:#4b5563;">
                  Olá, __NOME__. Finalize o pagamento para receber seus créditos.
                </p>
              </td>
            </tr>

            <!-- Resumo -->
            <tr>
              <td class="px" style="padding:28px 40px 0 40px;">
                <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid #eceef1;">
                  <tr>
                    <td style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:14px;line-height:20px;color:#6b7280;">Plano</td>
                    <td align="right" style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:15px;line-height:20px;font-weight:600;color:#0b0e14;">__PLANO__</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:14px;line-height:20px;color:#6b7280;">EvoCash</td>
                    <td align="right" style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:15px;line-height:20px;font-weight:600;color:#0b0e14;">__EVOCASH__</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:14px;line-height:20px;color:#6b7280;">Valor</td>
                    <td align="right" style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:15px;line-height:20px;font-weight:600;color:#0b0e14;">__VALOR__</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:14px;line-height:20px;color:#6b7280;">Data</td>
                    <td align="right" style="padding:14px 0;border-bottom:1px solid #eceef1;font-size:15px;line-height:20px;font-weight:600;color:#0b0e14;">__DATA__</td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Botão -->
            <tr>
              <td class="px" style="padding:32px 40px 0 40px;">
                <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation">
                  <tr>
                    <td align="center" bgcolor="#22c55e" style="border-radius:10px;background-color:#22c55e;">
                      <a class="btn" href="__LINK_PAGAMENTO__" target="_blank" style="display:block;padding:16px 24px;font-size:16px;line-height:24px;font-weight:700;color:#0b0e14;border-radius:10px;">Concluir pagamento</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Nota -->
            <tr>
              <td class="px" style="padding:24px 40px 0 40px;font-size:14px;line-height:22px;color:#6b7280;">
                Já pagou? Aguarde a confirmação; nenhuma ação é necessária.
                Dúvidas? Escreva para <a href="mailto:__EMAIL_SUPORTE__" style="color:#15803d;font-weight:600;">__EMAIL_SUPORTE__</a>.
              </td>
            </tr>

            <!-- Rodapé -->
            <tr>
              <td class="px" style="padding:32px 40px 36px 40px;font-size:12px;line-height:18px;color:#9ca3af;">
                Protocolo __PROTOCOLO__<br />
                Email transacional sobre uma compra pendente em sua conta Evolutus.
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>
  </body>
</html>`

export function buildReminderEmail({
  username, packageLabel, cashAmount, amountCentavos, createdAt, appUrl, supportEmail, purchaseId,
}) {
  // No ?lembrete=1 (or any other) query param: EvoCash.jsx has no code path that reads one
  // (only checkout_return, used by the InfinitePay redirect itself) -- a tracking param
  // with no consumer would just be dead weight on the link.
  const continueUrl = `${appUrl}/evocash`
  const amount = formatBRL(amountCentavos)
  const date = formatDateBR(createdAt)
  const nome = `@${username}`
  const subject = `Sua compra de ${cashAmount} EvoCash está pendente`

  const html = HTML_TEMPLATE
    .replaceAll('__NOME__', escapeHtml(nome))
    .replaceAll('__PLANO__', escapeHtml(packageLabel))
    .replaceAll('__EVOCASH__', escapeHtml(String(cashAmount)))
    .replaceAll('__VALOR__', escapeHtml(amount))
    .replaceAll('__DATA__', escapeHtml(date))
    .replaceAll('__LINK_PAGAMENTO__', escapeHtml(continueUrl))
    .replaceAll('__EMAIL_SUPORTE__', escapeHtml(supportEmail))
    .replaceAll('__PROTOCOLO__', escapeHtml(purchaseId))

  const text = [
    `Olá, ${nome}. Finalize o pagamento para receber seus créditos.`,
    '',
    `Plano: ${packageLabel}`,
    `EvoCash: ${cashAmount}`,
    `Valor: ${amount}`,
    `Data: ${date}`,
    '',
    `Concluir pagamento: ${continueUrl}`,
    '',
    'Já pagou? Aguarde a confirmação; nenhuma ação é necessária.',
    `Dúvidas? Escreva para ${supportEmail}.`,
    '',
    `Protocolo ${purchaseId}`,
    'Email transacional sobre uma compra pendente em sua conta Evolutus.',
  ].join('\n')

  return { subject, html, text }
}
