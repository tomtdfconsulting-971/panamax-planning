// api/_admin.js — SDK Admin Firebase (préfixe _ : non exposé comme endpoint)
// Nécessaire pour agir sur un compte autre que le sien : suppression
// et changement de mot de passe. L'API par clé publique ne le permet pas.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let _ready = null;

function ensureApp() {
  if (_ready !== null) return _ready;

  const projectId   = process.env.FIREBASE_PROJECT_ID || 'panamax-planning';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    console.error('FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY manquants');
    _ready = false;
    return false;
  }

  try {
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          // Les retours à la ligne sont échappés dans les variables Vercel
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });
    }
    _ready = true;
    return true;
  } catch (e) {
    console.error('Init SDK Admin:', e.message);
    _ready = false;
    return false;
  }
}

// Supprime définitivement un compte Firebase Auth
export async function adminDeleteUser(uid) {
  if (!ensureApp()) return { error: "SDK Admin non configuré sur Vercel." };
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
  if (!ensureApp()) return { error: "SDK Admin non configuré sur Vercel." };
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

export function adminAvailable() { return ensureApp(); }
