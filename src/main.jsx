import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'

// Firebase config
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

// Polyfill window.storage avec Firestore
window.storage = {
  get: async (key, shared) => {
    try {
      const col = shared ? 'shared' : 'private';
      const ref = doc(db, col, key.replace(/[/]/g, '_'));
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { key, value: snap.data().value, shared: !!shared };
    } catch (e) {
      console.error('storage.get error', e);
      return null;
    }
  },
  set: async (key, value, shared) => {
    try {
      const col = shared ? 'shared' : 'private';
      const ref = doc(db, col, key.replace(/[/]/g, '_'));
      await setDoc(ref, { value, updatedAt: Date.now() });
      return { key, value, shared: !!shared };
    } catch (e) {
      console.error('storage.set error', e);
      return null;
    }
  },
  delete: async (key, shared) => {
    try {
      const { deleteDoc } = await import('firebase/firestore');
      const col = shared ? 'shared' : 'private';
      const ref = doc(db, col, key.replace(/[/]/g, '_'));
      await deleteDoc(ref);
      return { key, deleted: true };
    } catch (e) {
      return null;
    }
  },
  list: async (prefix, shared) => {
    return { keys: [], prefix, shared: !!shared };
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
