import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ─── AI Worker (Cloudflare) ──────────────────────────────────────────────────
// Set VITE_AI_WORKER_URL in .env to the deployed Worker origin, e.g.
//   https://sdet-ai-worker.<your-subdomain>.workers.dev
// or http://localhost:8787 when running `wrangler dev`.

export const AI_WORKER_URL = import.meta.env.VITE_AI_WORKER_URL || '';

async function callWorker(path, payload) {
  if (!AI_WORKER_URL) {
    throw new Error('VITE_AI_WORKER_URL is not configured. See .env.example.');
  }
  const user = auth.currentUser;
  if (!user) throw new Error('Sign-in required.');
  const idToken = await user.getIdToken();

  const res = await fetch(`${AI_WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `Worker error (${res.status})`;
    const detail = data?.detail ? ` — model said: ${String(data.detail).slice(0, 300)}` : '';
    throw new Error(msg + detail);
  }
  return data;
}

export const callParseJD              = (jdText)   => callWorker('/parseJD', { jdText });
export const callGenerateQuestionBank = (position) => callWorker('/generateQuestionBank', { position });
export const callLiveSuggestion       = (payload)  => callWorker('/liveSuggestion', payload);
export const callEvaluateSession      = (payload)  => callWorker('/evaluateSession', payload);
export const callBiasAudit            = (report)   => callWorker('/biasAudit', { report });
