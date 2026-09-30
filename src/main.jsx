import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  setPersistence,
  browserLocalPersistence,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyD5CN_OaYLUTY6wRreTbS7q76kiJigvBZk",
  authDomain: "panamax-planning.firebaseapp.com",
  projectId: "panamax-planning",
  storageBucket: "panamax-planning.firebasestorage.app",
  messagingSenderId: "297129821916",
  appId: "1:297129821916:web:b43b66a04a07d9d47f5619"
};

const firebaseApp = initializeApp(firebaseConfig);
const db   = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// Session persistante : l'utilisateur reste connecté après fermeture de l'app
setPersistence(auth, browserLocalPersistence).catch(e => console.error('Persistence:', e));

const safeKey   = (key) => key.replace(/[^a-zA-Z0-9_-]/g, '_');
const USERS_KEY = 'panamax-v3-users';

const listeners = {};

window.storage = {
  get: async (key) => {
    try {
      const ref  = doc(db, 'panamax', safeKey(key));
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { key, value: snap.data().value, shared: true };
    } catch (e) {
      console.error('storage.get error:', e);
      return null;
    }
  },

  set: async (key, value) => {
    try {
      const ref = doc(db, 'panamax', safeKey(key));
      await setDoc(ref, { value, updatedAt: Date.now() });
      return { key, value, shared: true };
    } catch (e) {
      console.error('storage.set error:', e);
      return null;
    }
  },

  delete: async (key) => {
    try {
      const ref = doc(db, 'panamax', safeKey(key));
      await deleteDoc(ref);
      return { key, deleted: true };
    } catch (e) { return null; }
  },

  list: async () => ({ keys: [] }),

  subscribe: (key, callback) => {
    const k = safeKey(key);
    if (listeners[k]) listeners[k]();
    const ref = doc(db, 'panamax', k);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        callback({ key, value: snap.data().value, shared: true });
      }
    }, (err) => {
      console.error('onSnapshot error:', err);
    });
    listeners[k] = unsub;
    return unsub;
  },

  unsubscribe: (key) => {
    const k = safeKey(key);
    if (listeners[k]) { listeners[k](); delete listeners[k]; }
  },
};

// ── API d'authentification exposée à l'app ──────────────────────
window.auth = {
  signIn:     (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
  signOut:    () => fbSignOut(auth),
  getIdToken: async () => auth.currentUser ? auth.currentUser.getIdToken() : null,
  get uid()   { return auth.currentUser?.uid   || null; },
  get email() { return auth.currentUser?.email || null; },

  // Chaque utilisateur reste maître de son mot de passe.
  // Firebase exige une réauthentification récente pour cette opération.
  changePassword: async (currentPassword, newPassword) => {
    const u = auth.currentUser;
    if (!u) throw Object.assign(new Error('Non connecté'), { code: 'auth/no-user' });
    const cred = EmailAuthProvider.credential(u.email, currentPassword);
    await reauthenticateWithCredential(u, cred);
    await updatePassword(u, newPassword);
  },
};

// Messages d'erreur Firebase traduits en français
window.authErrorMessage = (code) => ({
  'auth/invalid-email':          "Adresse email invalide.",
  'auth/user-disabled':          "Ce compte a été désactivé.",
  'auth/user-not-found':         "Identifiants incorrects.",
  'auth/wrong-password':         "Identifiants incorrects.",
  'auth/invalid-credential':     "Identifiants incorrects.",
  'auth/too-many-requests':      "Trop de tentatives. Réessayez dans quelques minutes.",
  'auth/network-request-failed': "Connexion internet indisponible.",
  'auth/weak-password':          "Mot de passe trop court (6 caractères minimum).",
  'auth/requires-recent-login':  "Reconnectez-vous avant de changer votre mot de passe.",
}[code] || "Connexion impossible. Réessayez.");

// ── Filet de sécurité ──────────────────────────────────────────
// Sans cela, la moindre erreur de rendu donne une page blanche muette.
// Ici l'erreur s'affiche, lisible depuis un téléphone.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null, info: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Erreur de rendu :", err, info); this.setState({ info }); }
  render() {
    if (!this.state.err) return this.props.children;
    const pile = (this.state.info?.componentStack || "").split("\n").slice(0, 6).join("\n");
    return (
      <div style={{ minHeight:"100vh", background:"#FEF8F6", padding:"24px 16px", boxSizing:"border-box",
                    fontFamily:"'Segoe UI', system-ui, sans-serif", color:"#0D3D52" }}>
        <div style={{ maxWidth:520, margin:"0 auto" }}>
          <div style={{ fontSize:38, marginBottom:8 }}>⚠️</div>
          <h2 style={{ margin:"0 0 6px", color:"#D6202A", fontSize:18 }}>L'application a rencontré une erreur</h2>
          <p style={{ color:"#666", fontSize:13, lineHeight:1.6, marginBottom:16 }}>
            Transmettez ce message pour correction. Vos données ne sont pas affectées.
          </p>
          <pre style={{ background:"#fff", border:"1px solid #E8673A40", borderRadius:10, padding:"12px 14px",
                        fontSize:11.5, lineHeight:1.5, whiteSpace:"pre-wrap", wordBreak:"break-word",
                        color:"#D6202A", margin:"0 0 14px" }}>
{String(this.state.err?.message || this.state.err)}
          </pre>
          {pile && (
            <pre style={{ background:"#fff", border:"1px solid #e0eef3", borderRadius:10, padding:"12px 14px",
                          fontSize:10.5, lineHeight:1.5, whiteSpace:"pre-wrap", wordBreak:"break-word",
                          color:"#888", margin:"0 0 16px" }}>{pile}</pre>
          )}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button onClick={() => window.location.reload()}
              style={{ background:"#1A5F7A", color:"#fff", border:"none", borderRadius:10, padding:"11px 20px",
                       fontSize:14, fontWeight:700, cursor:"pointer" }}>Recharger</button>
            <button onClick={() => fbSignOut(auth).then(() => window.location.reload())}
              style={{ background:"#fff", color:"#1A5F7A", border:"1px solid #1A5F7A40", borderRadius:10,
                       padding:"11px 20px", fontSize:14, fontWeight:700, cursor:"pointer" }}>Se déconnecter</button>
          </div>
        </div>
      </div>
    );
  }
}

// ── Chargeur : gère l'état d'authentification et le rôle ────────
function AuthLoader() {
  const [state, setState] = React.useState({ status: 'loading', session: null });

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setState({ status: 'anon', session: null }); return; }

      try {
        const snap = await getDoc(doc(db, 'panamax', USERS_KEY));
        const all  = snap.exists() ? JSON.parse(snap.data().value || '{}') : {};
        const me   = (all.users || {})[user.uid];

        if (!me || me.active === false) {
          await fbSignOut(auth);
          setState({
            status: 'anon',
            session: null,
            notice: !me
              ? "Votre compte n'est rattaché à aucun profil. Contactez l'administrateur."
              : "Votre compte a été désactivé.",
          });
          return;
        }

        setState({ status: 'ready', session: {
          uid:    user.uid,
          email:  user.email,
          role:   me.role,          // 'admin' | 'commercial' | 'skipper'
          refKey: me.refKey || null,
          name:   me.name   || user.email,
        }});
      } catch (e) {
        console.error('Chargement du rôle:', e);
        setState({ status: 'anon', session: null, notice: "Impossible de charger votre profil." });
      }
    });
    return () => unsub();
  }, []);

  if (state.status === 'loading') return (
    <div style={{ minHeight:"100vh", background:"#0D3D52", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#fff", fontFamily:"system-ui", gap:16 }}>
      <img src="/1-ICONE-POISSON-PANAMAX-Original.png" alt="Panamax" style={{ width:80, height:80, objectFit:"contain", animation:"pulse 1.5s ease-in-out infinite" }} />
      <div style={{ fontSize:15, color:"rgba(255,255,255,0.6)" }}>Chargement…</div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );

  return (
    <ErrorBoundary>
      <App session={state.session} notice={state.notice} />
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthLoader />
  </React.StrictMode>,
)
