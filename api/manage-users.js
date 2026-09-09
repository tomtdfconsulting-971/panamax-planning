// api/manage-users.js — Gestion des comptes depuis l'admin de l'application.
// Toute action exige un jeton d'un utilisateur ayant le rôle « admin ».

import { verifyIdToken, createAuthUser, loadUsers, saveUsers, FB_API_KEY } from './_firebase.js';
import { adminDeleteUser, adminSetEmail, adminAvailable } from './_admin.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Vérifier l'identité de l'appelant ────────────────────
  const idToken = (req.headers.authorization || '').replace('Bearer ', '');
  const caller  = await verifyIdToken(idToken);
  if (!caller) return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });

  // ── 2. Vérifier qu'il est bien administrateur ───────────────
  const data = await loadUsers();
  const me   = data.users[caller.uid];
  if (!me || me.role !== 'admin' || me.active === false) {
    return res.status(403).json({ error: 'Action réservée aux administrateurs.' });
  }

  const { action, email, password, name, role, refKey, uid } = req.body || {};

  try {
    switch (action) {

      // ── Créer un compte ───────────────────────────────────
      case 'create': {
        if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis.' });
        if (!['admin', 'commercial', 'skipper'].includes(role)) {
          return res.status(400).json({ error: 'Rôle invalide.' });
        }
        if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });

        const created = await createAuthUser(email.trim().toLowerCase(), password);
        if (created.error) return res.status(400).json({ error: created.error });

        data.users[created.uid] = {
          email: email.trim().toLowerCase(),
          name:  name || email,
          role,
          refKey:    role === 'commercial' ? (refKey || null) : null,
          active:    true,
          createdAt: new Date().toISOString(),
          createdBy: caller.email,
        };
        const ok = await saveUsers(data);
        return res.status(200).json({ success: ok, uid: created.uid });
      }

      // ── Activer / désactiver ──────────────────────────────
      case 'toggle': {
        if (!uid || !data.users[uid]) return res.status(404).json({ error: 'Compte introuvable.' });
        if (uid === caller.uid)       return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
        data.users[uid].active = !data.users[uid].active;
        const ok = await saveUsers(data);
        return res.status(200).json({ success: ok, active: data.users[uid].active });
      }

      // ── Modifier nom / rôle / référent ────────────────────
      case 'update': {
        if (!uid || !data.users[uid]) return res.status(404).json({ error: 'Compte introuvable.' });
        if (uid === caller.uid && role && role !== 'admin') {
          return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre rôle admin.' });
        }
        if (name) data.users[uid].name = name;
        if (role && ['admin', 'commercial', 'skipper'].includes(role)) {
          data.users[uid].role   = role;
          data.users[uid].refKey = role === 'commercial' ? (refKey || data.users[uid].refKey || null) : null;
        } else if (refKey !== undefined) {
          data.users[uid].refKey = refKey;
        }
        const ok = await saveUsers(data);
        return res.status(200).json({ success: ok });
      }

      // ── Modifier l'adresse email d'un compte ──────────────
      case 'email': {
        if (!uid || !data.users[uid]) return res.status(404).json({ error: 'Compte introuvable.' });
        const mail = String(email || '').trim().toLowerCase();
        if (!mail.includes('@') || !mail.includes('.')) {
          return res.status(400).json({ error: 'Adresse email invalide.' });
        }
        const dejaPris = Object.entries(data.users)
          .some(([k, u]) => k !== uid && (u.email || '').toLowerCase() === mail);
        if (dejaPris) return res.status(400).json({ error: "Cette adresse est déjà utilisée par un autre compte." });

        const r = await adminSetEmail(uid, mail);
        if (r.error) return res.status(400).json({ error: r.error });

        const ancien = data.users[uid].email;
        data.users[uid].email = mail;
        const ok = await saveUsers(data);
        return res.status(200).json({ success: ok, ancien, nouveau: mail });
      }

      // ── Envoyer un lien de réinitialisation par email ─────
      case 'password-email': {
        if (!uid || !data.users[uid]) return res.status(404).json({ error: 'Compte introuvable.' });
        const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FB_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: data.users[uid].email }),
        });
        const d = await r.json();
        if (d.error) return res.status(400).json({ error: d.error.message });
        return res.status(200).json({ success: true, mode: 'email', email: data.users[uid].email });
      }

      // ── Supprimer définitivement un compte ────────────────
      case 'delete': {
        if (!uid || !data.users[uid]) return res.status(404).json({ error: 'Compte introuvable.' });
        if (uid === caller.uid) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });

        // Un administrateur ne peut pas en supprimer un autre.
        // La suppression d'un admin se fait depuis la console Firebase.
        if (data.users[uid].role === 'admin') {
          return res.status(403).json({ error: "Un compte administrateur ne peut pas être supprimé depuis l'application." });
        }

        const r = await adminDeleteUser(uid);
        if (r.error) return res.status(400).json({ error: r.error });

        const email = data.users[uid].email;
        delete data.users[uid];
        const ok = await saveUsers(data);
        return res.status(200).json({ success: ok, email, note: r.note });
      }

      // ── Diagnostic : le SDK Admin est-il configuré ? ──────
      case 'capabilities':
        return res.status(200).json({ success: true, admin: adminAvailable() });

      // ── Lister ────────────────────────────────────────────
      case 'list':
        return res.status(200).json({ success: true, users: data.users });

      default:
        return res.status(400).json({ error: 'Action inconnue.' });
    }
  } catch (err) {
    console.error('manage-users:', err);
    return res.status(500).json({ error: err.message });
  }
}
