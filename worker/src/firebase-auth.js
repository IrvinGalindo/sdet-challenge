// Verifies a Firebase Auth ID token. Caches Google's signing certificates
// in module-scope memory for the lifetime of a Worker isolate.

import { jwtVerify, importX509 } from 'jose';

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache = { keys: null, expiresAt: 0 };

async function loadCerts() {
  if (certCache.keys && Date.now() < certCache.expiresAt) {
    return certCache.keys;
  }
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error(`Failed to fetch Google certs: ${res.status}`);
  const certs = await res.json();
  // Cache-Control: max-age=N — respect it; default 1h.
  const cacheControl = res.headers.get('cache-control') || '';
  const m = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = (m ? Number(m[1]) : 3600) * 1000;
  certCache = { keys: certs, expiresAt: Date.now() + ttlMs };
  return certs;
}

export async function verifyFirebaseToken(token, projectId) {
  if (!token) throw httpError(401, 'Missing ID token');
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID not configured');

  const certs = await loadCerts();

  // Decode header (without verification) to find the kid.
  const [headerB64] = token.split('.');
  let header;
  try {
    header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    throw httpError(401, 'Malformed ID token');
  }

  const cert = certs[header.kid];
  if (!cert) throw httpError(401, 'Unknown key id');

  let publicKey;
  try {
    publicKey = await importX509(cert, 'RS256');
  } catch (e) {
    throw httpError(500, 'Failed to import signing certificate');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, publicKey, {
      issuer:   `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    }));
  } catch (e) {
    throw httpError(401, 'Invalid ID token: ' + (e.message || e.code));
  }

  if (!payload.sub) throw httpError(401, 'ID token missing sub');
  return { uid: payload.sub, email: payload.email || null, claims: payload };
}

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}
