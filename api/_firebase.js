// api/_firebase.js — Utilitaires Firebase partagés (préfixe _ : non exposé comme endpoint)

export const FB_PROJECT = process.env.FIREBASE_PROJECT_ID || 'panamax-planning';
export const FB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

// Compte technique utilisé par les fonctions serveur
const SVC_EMAIL = process.env.FIREBASE_SERVICE_EMAIL;
const SVC_PASS  = process.env.FIREBASE_SERVICE_PASSWORD;

let _tok = null, _tokExp = 0;

// Jeton du compte technique (remplace l'ancienne authentification anonyme)
export async function getServiceToken() {
  if (_tok && Date.now() < _tokExp) return _tok;
  if (!SVC_EMAIL || !SVC_PASS) {
    console.error('FIREBASE_SERVICE_EMAIL / FIREBASE_SERVICE_PASSWORD manquants');
    return null;
  }
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SVC_EMAIL, password: SVC_PASS, returnSecureToken: true }),
    });
    const d = await r.json();
    if (!d.idToken) { console.error('Auth compte technique échouée:', d.error?.message); return null; }
    _tok = d.idToken;
    _tokExp = Date.now() + 50 * 60 * 1000;
    return _tok;
  } catch (e) { console.error('Auth compte technique:', e.message); return null; }
}

export async function fbGet(key) {
  const token = await getServiceToken();
  if (!token) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/panamax/${key}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) { console.error('Firestore lecture refusée:', res.status, await res.text()); return null; }
  const doc = await res.json();
  return doc?.fields?.value?.stringValue || null;
}

export async function fbSet(key, value) {
  const token = await getServiceToken();
  if (!token) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/panamax/${key}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ fields: { value: { stringValue: value }, updatedAt: { integerValue: String(Date.now()) } } }),
  });
  if (!res.ok) console.error('Firestore écriture refusée:', res.status, await res.text());
  return res.ok;
}

// Vérifie un jeton envoyé par le navigateur et renvoie l'uid + email
export async function verifyIdToken(idToken) {
  if (!idToken) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const d = await r.json();
  const u = d.users?.[0];
  return u ? { uid: u.localId, email: u.email } : null;
}

// Crée un compte Firebase Auth et renvoie son uid
export async function createAuthUser(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  const d = await r.json();
  if (!d.localId) {
    const map = {
      EMAIL_EXISTS:      "Cette adresse email est déjà utilisée.",
      INVALID_EMAIL:     "Adresse email invalide.",
      WEAK_PASSWORD:     "Mot de passe trop court (6 caractères minimum).",
      OPERATION_NOT_ALLOWED: "Activez Email/Password dans Firebase → Authentication.",
    };
    const raw = d.error?.message || 'ERREUR';
    return { error: map[raw.split(' ')[0]] || raw };
  }
  return { uid: d.localId };
}

export const USERS_KEY = 'panamax-v3-users';

// Charge la table des utilisateurs
export async function loadUsers() {
  const raw = await fbGet(USERS_KEY);
  if (!raw) return { users: {} };
  try { const p = JSON.parse(raw); return { users: p.users || {} }; }
  catch { return { users: {} }; }
}

export async function saveUsers(obj) {
  return fbSet(USERS_KEY, JSON.stringify(obj));
}
