// api/bootstrap-admin.js — Création du tout premier administrateur
// À n'utiliser qu'une fois, protégé par CRON_SECRET.
// Sert aussi à créer le compte technique des fonctions serveur.

import { createAuthUser, loadUsers, saveUsers } from './_firebase.js';

export default async function handler(req, res) {
  const secret = req.query?.secret || req.body?.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const email    = req.query?.email    || req.body?.email;
  const password = req.query?.password || req.body?.password;
  const name     = req.query?.name     || req.body?.name || email;
  const role     = req.query?.role     || req.body?.role || 'admin';

  if (!email || !password) {
    return res.status(400).json({
      error: 'Paramètres manquants',
      usage: '?secret=…&email=…&password=…&name=…&role=admin|commercial|skipper|service',
    });
  }

  try {
    // 1. Créer le compte dans Firebase Auth
    const created = await createAuthUser(email, password);
    if (created.error) return res.status(400).json({ error: created.error });

    // 2. Le compte technique n'a pas de profil applicatif
    if (role === 'service') {
      return res.status(200).json({
        success: true,
        role: 'service',
        uid: created.uid,
        message: "Compte technique créé. Renseignez FIREBASE_SERVICE_EMAIL et FIREBASE_SERVICE_PASSWORD sur Vercel.",
      });
    }

    // 3. Enregistrer le profil applicatif
    const data = await loadUsers();
    data.users[created.uid] = {
      email, name, role,
      refKey:    req.query?.refKey || null,
      active:    true,
      createdAt: new Date().toISOString(),
    };
    const saved = await saveUsers(data);

    return res.status(200).json({
      success: saved,
      uid: created.uid,
      email, name, role,
      total: Object.keys(data.users).length,
      message: saved ? 'Compte créé.' : "Compte Auth créé mais profil non enregistré — vérifiez le compte technique.",
    });
  } catch (err) {
    console.error('bootstrap-admin:', err);
    return res.status(500).json({ error: err.message });
  }
}
