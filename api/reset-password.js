// api/reset-password.js — Envoi d'un email de réinitialisation de mot de passe
// Public, mais ne révèle jamais si un compte existe (anti-énumération).

const FB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Adresse email requise.' });

  try {
    await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FB_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: String(email).trim().toLowerCase() }),
    });
    // Réponse identique que le compte existe ou non
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('reset-password:', err);
    return res.status(200).json({ success: true });
  }
}
