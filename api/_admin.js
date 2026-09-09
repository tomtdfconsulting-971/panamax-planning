// api/_admin.js — SDK Admin Firebase (préfixe _ : non exposé comme endpoint)
// Nécessaire pour agir sur un compte autre que le sien : suppression
// et changement d'adresse email. L'API par clé publique ne le permet pas.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let _ready  = null;
let _reason = '';

// Nettoie la clé privée telle qu'elle a pu être collée dans Vercel :
// guillemets englobants, \n littéraux, espaces parasites.
function normaliseKey(raw) {
  let k = String(raw || '').trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\n/g, '\n');   // \n littéraux → vrais retours à la ligne
  return k.trim() + '\n';
}

function ensureApp() {
  if (_ready !== null) return _ready;

  const projectId   = process.env.FIREBASE_PROJECT_ID || 'panamax-planning';
  const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '').trim();
  const rawKey      = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!clientEmail && !rawKey) {
    _reason = "Les deux variables FIREBASE_ADMIN_CLIENT_EMAIL et FIREBASE_ADMIN_PRIVATE_KEY sont absentes sur Vercel (avez-vous redéployé ?).";
    _ready = false; return false;
  }
  if (!clientEmail) {
    _reason = "FIREBASE_ADMIN_CLIENT_EMAIL est absente sur Vercel.";
    _ready = false; return false;
  }
  if (!rawKey) {
    _reason = "FIREBASE_ADMIN_PRIVATE_KEY est absente sur Vercel.";
    _ready = false; return false;
  }

  const privateKey = normaliseKey(rawKey);

  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    _reason = "FIREBASE_ADMIN_PRIVATE_KEY ne ressemble pas à une clé privée : elle doit commencer par -----BEGIN PRIVATE KEY-----.";
    _ready = false; return false;
  }
  if (!clientEmail.includes('@') || !clientEmail.includes('iam.gserviceaccount.com')) {
    _reason = `FIREBASE_ADMIN_CLIENT_EMAIL ne ressemble pas à un compte de service (attendu : ...@${projectId}.iam.gserviceaccount.com).`;
    _ready = false; return false;
  }

  try {
    if (!getApps().length) {
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    }
    _ready = true; _reason = '';
    return true;
  } catch (e) {
    _reason = `Initialisation refusée par Firebase : ${e.message}`;
    console.error('Init SDK Admin:', e.message);
    _ready = false; return false;
  }
}

const indispo = () => ({ error: `SDK Admin indisponible. ${_reason}` });

// Supprime définitivement un compte Firebase Auth
export async function adminDeleteUser(uid) {
  if (!ensureApp()) return indispo();
  try {
    await getAuth().deleteUser(uid);
    return { success: true };
  } catch (e) {
    if (e.code === 'auth/user-not-found') return { success: true, note: 'compte déjà absent' };
    return { error: e.message };
  }
}

// Change l'adresse email d'un compte.
// Le mot de passe reste volontairement hors de portée de l'administrateur :
// seul l'utilisateur peut le modifier, depuis son espace « Mon compte ».
export async function adminSetEmail(uid, email) {
  if (!ensureApp()) return indispo();
  try {
    await getAuth().updateUser(uid, { email: email.trim().toLowerCase() });
    return { success: true };
  } catch (e) {
    const map = {
      'auth/email-already-exists': "Cette adresse est déjà utilisée par un autre compte.",
      'auth/invalid-email':        "Adresse email invalide.",
    };
    return { error: map[e.code] || e.message };
  }
}

// Diagnostic — ne révèle jamais la clé elle-même
export function adminDiagnostic() {
  const ok = ensureApp();
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY || '';
  return {
    operationnel: ok,
    raison: _reason || null,
    clientEmailPresent: !!(process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '').trim(),
    clientEmailApercu: (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '').trim().slice(0, 22) + '…',
    cleLongueur: raw.length,
    cleCommenceParBegin: normaliseKey(raw).includes('BEGIN PRIVATE KEY'),
    projectId: process.env.FIREBASE_PROJECT_ID || 'panamax-planning',
  };
}

export function adminAvailable() { return ensureApp(); }
