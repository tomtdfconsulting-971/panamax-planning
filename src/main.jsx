import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyD5CN_OaYLUTY6wRreTbS7q76kiJigvBZk",
  authDomain: "panamax-planning.firebaseapp.com",
  projectId: "panamax-planning",
  storageBucket: "panamax-planning.firebasestorage.app",
  messagingSenderId: "297129821916",
  appId: "1:297129821916:web:b43b66a04a07d9d47f5619"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Toutes les données dans la collection "panamax" (autorisée par les règles Firestore)
const safeKey = (key) => key.replace(/[^a-zA-Z0-9_-]/g, '_');

window.storage = {
  get: async (key) => {
    try {
      const ref = doc(db, 'panamax', safeKey(key));
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
    } catch (e) {
      return null;
    }
  },
  list: async (prefix) => {
    return { keys: [], prefix };
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
