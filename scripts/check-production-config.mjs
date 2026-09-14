#!/usr/bin/env node
// AUD-012: nada impedia um deploy de produção sem VITE_RECAPTCHA_SITE_KEY configurada.
// O app funciona normalmente sem ela (silencioso, de propósito -- ver
// src/firebase/config.js), então um deploy faltando essa variável passava
// despercebido: nenhum token de App Check é gerado, e enforcement configurado no
// console do Firebase passaria a bloquear todo tráfego legítimo (ou, se enforcement
// nunca foi ligado, o projeto simplesmente nunca esteve protegido contra clientes
// automatizados). Este script roda antes do deploy (ver firebase.json,
// hosting.predeploy) e falha alto se a chave não estiver presente no ambiente usado
// para o build -- com um escape hatch explícito para quem realmente precisa publicar
// sem App Check por enquanto (ex.: primeiro deploy, antes do reCAPTCHA existir).
import { loadEnv } from 'vite'

if (process.env.SKIP_APPCHECK_CHECK === 'true') {
  console.warn(
    '⚠ SKIP_APPCHECK_CHECK=true -- pulando a checagem de VITE_RECAPTCHA_SITE_KEY. ' +
      'Confirme que rodar sem App Check é uma decisão deliberada para este deploy.'
  )
  process.exit(0)
}

const mode = process.env.NODE_ENV || 'production'
const env = loadEnv(mode, process.cwd(), 'VITE_')

if (!env.VITE_RECAPTCHA_SITE_KEY) {
  console.error(
    '\n✖ VITE_RECAPTCHA_SITE_KEY não está definida.\n' +
      '  O deploy de produção espera o App Check configurado (site key do reCAPTCHA v3\n' +
      '  cadastrado no console do Firebase) para o app conseguir gerar tokens de App\n' +
      '  Check. Configure VITE_RECAPTCHA_SITE_KEY no seu .env antes de publicar.\n\n' +
      '  Se publicar sem App Check for mesmo intencional agora (ex.: primeiro deploy,\n' +
      '  antes do reCAPTCHA existir), rode com SKIP_APPCHECK_CHECK=true.\n'
  )
  process.exit(1)
}

console.log('✔ VITE_RECAPTCHA_SITE_KEY configurada -- App Check pode gerar tokens neste build.')
