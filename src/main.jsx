import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'

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

const safeKey = (key) => key.replace(/[^a-zA-Z0-9_-]/g, '_');

// Listeners registry for real-time updates
const listeners = {};

window.storage = {
  // Get once
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

  // Set value
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

  // Delete
  delete: async (key) => {
    try {
      const ref = doc(db, 'panamax', safeKey(key));
      await deleteDoc(ref);
      return { key, deleted: true };
    } catch (e) { return null; }
  },

  list: async () => ({ keys: [] }),

  // Real-time listener — called every time the doc changes in Firebase
  subscribe: (key, callback) => {
    const k = safeKey(key);
    // Unsubscribe any existing listener for this key
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

  // Unsubscribe a listener
  unsubscribe: (key) => {
    const k = safeKey(key);
    if (listeners[k]) { listeners[k](); delete listeners[k]; }
  },
};

function AuthLoader() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    signInAnonymously(auth)
      .then(() => setReady(true))
      .catch(err => { console.error('Auth error:', err); setError(err.message); });
    const unsub = onAuthStateChanged(auth, (user) => { if (user) setReady(true); });
    return () => unsub();
  }, []);

  if (error) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"system-ui", flexDirection:"column", gap:16, background:"#0D3D52", color:"#fff" }}>
      <div style={{ fontSize:48 }}>⚠️</div>
      <div style={{ fontSize:16, color:"rgba(255,255,255,0.7)", textAlign:"center", maxWidth:320 }}>Erreur de connexion.<br/>Vérifiez votre connexion internet.</div>
      <button onClick={()=>window.location.reload()} style={{ background:"#1A5F7A", color:"#fff", border:"none", borderRadius:10, padding:"10px 24px", cursor:"pointer", fontSize:14, fontWeight:700 }}>Réessayer</button>
    </div>
  );

  if (!ready) return (
    <div style={{ minHeight:"100vh", background:"#0D3D52", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:"#fff", fontFamily:"system-ui", gap:16 }}>
      <img src="/1-ICONE-POISSON-PANAMAX-Original.png" alt="Panamax" style={{ width:80, height:80, objectFit:"contain", animation:"pulse 1.5s ease-in-out infinite" }} />
      <div style={{ fontSize:15, color:"rgba(255,255,255,0.6)" }}>Connexion en cours…</div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthLoader />
  </React.StrictMode>,
)
