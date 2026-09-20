import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'southamerica-east1')
export const storage = getStorage(app)

// us-central1 -- só o voto econômico (voteOnPostV2) roda aqui, desde a migração pós
// A/B (66-77% mais rápido que southamerica-east1 contra o mesmo banco nam5, ver
// economyService.js castVote). Toda outra Function continua em `functions` acima.
export const functionsUsCentral = getFunctions(app, 'us-central1')

if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  connectFunctionsEmulator(functionsUsCentral, '127.0.0.1', 5001)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}

// Sem chave configurada, o app continua funcionando normalmente (sem token de App
// Check) — assim isso nunca quebra ambientes onde o reCAPTCHA ainda não foi cadastrado
// no console do Firebase. Enforcement (recusar quem não manda token) é ligado à parte,
// manualmente, só depois que o site key estiver publicado e gerando tokens de verdade.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY
if (recaptchaSiteKey) {
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' || import.meta.env.DEV) {
    // Debug token: gerado uma vez no console, registra o navegador local/CI como
    // confiável sem depender do reCAPTCHA real (que não funciona contra localhost/emulador).
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}
