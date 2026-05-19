import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Polyfill window.storage with localStorage for production
window.storage = {
  get: async (key, shared) => {
    const k = shared ? `shared_${key}` : key;
    const v = localStorage.getItem(k);
    return v ? { key, value: v, shared: !!shared } : null;
  },
  set: async (key, value, shared) => {
    const k = shared ? `shared_${key}` : key;
    localStorage.setItem(k, value);
    return { key, value, shared: !!shared };
  },
  delete: async (key, shared) => {
    const k = shared ? `shared_${key}` : key;
    localStorage.removeItem(k);
    return { key, deleted: true, shared: !!shared };
  },
  list: async (prefix, shared) => {
    const keys = Object.keys(localStorage)
      .filter(k => shared ? k.startsWith(`shared_${prefix||''}`) : k.startsWith(prefix||''))
      .map(k => shared ? k.replace('shared_', '') : k);
    return { keys, prefix, shared: !!shared };
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
