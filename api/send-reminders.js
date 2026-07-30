// api/send-reminders.js — Cron J-7 : envoie les rappels de paiement aux clients
// Déclenché automatiquement chaque jour à 8h00 par Vercel Cron

const FIREBASE_PROJECT  = process.env.FIREBASE_PROJECT_ID || 'panamax-planning';
const FIREBASE_API_KEY  = process.env.FIREBASE_WEB_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const EMAILJS_SERVICE   = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE  = process.env.EMAILJS_REMINDER_TEMPLATE_ID;
const EMAILJS_KEY       = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY; // optionnelle (mode strict)
const STORE_KEY         = 'panamax-v3';

// ── Authentification Firebase (anonyme, comme l'app) ──────────
// Les règles Firestore exigent un utilisateur authentifié : on obtient
// un jeton anonyme avant chaque lecture/écriture.
let _tok = null, _tokExp = 0;
async function getIdToken() {
  if (_tok && Date.now() < _tokExp) return _tok;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    const d = await r.json();
    if (!d.idToken) { console.error('Auth Firebase échouée:', d.error?.message); return null; }
    _tok = d.idToken;
    _tokExp = Date.now() + 50 * 60 * 1000;   // jeton valable 1h, on garde une marge
    return _tok;
  } catch (e) { console.error('Auth Firebase erreur:', e.message); return null; }
}

async function firebaseGet(key) {
  const token = await getIdToken();
  if (!token) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/panamax/${key}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) { console.error('Firestore lecture refusée:', res.status, await res.text()); return null; }
  const doc = await res.json();
  return doc?.fields?.value?.stringValue || null;
}

async function firebaseSet(key, value) {
  const token = await getIdToken();
  if (!token) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/panamax/${key}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ fields: { value: { stringValue: value }, updatedAt: { integerValue: String(Date.now()) } } }),
  });
  if (!res.ok) console.error('Firestore écriture refusée:', res.status, await res.text());
  return res.ok;
}

function dateFromLabel(label) {
  if (!label) return null;
  const m = label.match(/(\d{1,2})\/(\d{2})/);
  if (!m) return null;
  const now = new Date();
  return new Date(now.getFullYear(), +m[2] - 1, +m[1]);
}

async function createStripeLink(amount, clientName, clientEmail, dateLabel, bookingId, dateId, boatId) {
  const APP_URL = 'https://panamax-planning.vercel.app';

  // NB : Stripe plafonne la durée de vie d'une session à 24 h.
  // On laisse donc la valeur par défaut (pas de champ `expires_at`).
  const params = {
    'payment_method_types[]':                                   'card',
    'mode':                                                     'payment',
    'success_url':                                              `${APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url':                                               `${APP_URL}/payment-cancel`,
    'line_items[0][price_data][currency]':                      'eur',
    'line_items[0][price_data][unit_amount]':                   String(Math.round(amount * 100)),
    'line_items[0][price_data][product_data][name]':            `Excursion Panamax — ${dateLabel}`,
    'line_items[0][price_data][product_data][description]':     `Solde de réservation pour ${clientName}`,
    'line_items[0][quantity]':                                  '1',
    'metadata[booking_id]':   bookingId  || '',
    'metadata[date_id]':      dateId     || '',
    'metadata[boat_id]':      boatId     || '',
    'metadata[client_name]':  clientName || '',
    'metadata[date_label]':   dateLabel  || '',
  };
  // Stripe refuse une adresse vide : on ne l'ajoute que si elle est valide
  if (clientEmail && clientEmail.includes('@') && clientEmail.includes('.')) {
    params['customer_email'] = clientEmail.trim();
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const session = await res.json();
  if (!session.url) {
    // On remonte la vraie erreur Stripe au lieu de l'avaler
    const msg = session.error?.message || 'réponse Stripe inattendue';
    console.error(`Stripe (${clientName}) :`, msg);
    return { error: msg };
  }
  return { url: session.url };
}

async function sendReminderEmail(to_name, to_email, date, reste, paymentUrl) {
  const payload = {
    service_id:  EMAILJS_SERVICE,
    template_id: EMAILJS_TEMPLATE,
    user_id:     EMAILJS_KEY,
    template_params: {
      to_name,
      to_email,
      date,
      reste:       `${reste}€`,
      payment_url: paymentUrl,
      reply_to:    'contact@panamaxexcursions.com',
    },
  };
  // La clé privée est requise pour les appels serveur en mode strict
  if (EMAILJS_PRIVATE_KEY) payload.accessToken = EMAILJS_PRIVATE_KEY;

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'origin': 'https://panamax-planning.vercel.app' },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true };

  // On remonte le message exact d'EmailJS
  const msg = (await res.text()).slice(0, 200);
  console.error(`EmailJS (${to_email}) : ${res.status} — ${msg}`);
  return { ok: false, error: `${res.status} — ${msg}` };
}

export default async function handler(req, res) {
  // Sécurité : Vercel Cron (header) OU test manuel (?secret=...)
  const authHeader = req.headers.authorization;
  const secretQS   = req.query?.secret;
  const ok = authHeader === `Bearer ${process.env.CRON_SECRET}` || secretQS === process.env.CRON_SECRET;
  if (!ok) return res.status(401).json({ error: 'Non autorisé' });

  // ?days=N pour tester sur un autre horizon (défaut : 7 jours)
  const horizon = parseInt(req.query?.days) || 7;
  // ?dry=1 pour simuler sans envoyer d'email
  const dryRun  = req.query?.dry === '1';

  // Diagnostic de configuration
  const config = {
    EMAILJS_SERVICE_ID:           !!EMAILJS_SERVICE,
    EMAILJS_REMINDER_TEMPLATE_ID: !!EMAILJS_TEMPLATE,
    EMAILJS_PUBLIC_KEY:           !!EMAILJS_KEY,
    STRIPE_SECRET_KEY:            !!STRIPE_SECRET_KEY,
    FIREBASE_WEB_API_KEY:         !!FIREBASE_API_KEY,
  };
  const missing = Object.entries(config).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    return res.status(500).json({ error: 'Variables Vercel manquantes', missing });
  }

  try {
    const raw     = await firebaseGet(STORE_KEY);
    if (!raw) return res.status(200).json({ message: 'Aucune donnée' });
    const current = JSON.parse(raw);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let sent = 0;
    const marked  = [];            // IDs des réservations ayant reçu le rappel
    const results = [];
    const skipped = [];

    for (const date of current.dates) {
      const dateObj = dateFromLabel(date.label);
      if (!dateObj) continue;

      // Fenêtre glissante : excursion dans 0 à `horizon` jours (7 par défaut)
      const diff = Math.round((dateObj - today) / (1000 * 60 * 60 * 24));
      if (diff < 0 || diff > horizon) continue;

      for (const boat of date.boats) {
        for (const bk of boat.bookings) {
          const reste = Math.max(0, bk.price - (bk.acompte_amount || 0) - (bk.solde_encaisse || 0));

          // Raisons de ne pas envoyer — tracées pour le diagnostic
          if (bk.reminder_sent) { skipped.push({ name: bk.name, raison: 'rappel déjà envoyé' });   continue; }
          if (bk.stripe_paid)   { skipped.push({ name: bk.name, raison: 'déjà payé via Stripe' }); continue; }
          if (reste <= 0)     { skipped.push({ name: bk.name, raison: 'solde déjà réglé' });      continue; }
          if (!bk.email)      { skipped.push({ name: bk.name, raison: 'pas d\'email client' });   continue; }

          // Générer le lien Stripe
          const stripeRes  = await createStripeLink(reste, bk.name, bk.email, date.label, bk.id, date.id, boat.id);
          if (stripeRes.error) { skipped.push({ name: bk.name, raison: `Stripe : ${stripeRes.error}` }); continue; }
          const paymentUrl = stripeRes.url;

          if (dryRun) {
            results.push({ name: bk.name, email: bk.email, date: date.label, joursAvant: diff, reste, payment_url: paymentUrl, sent: 'SIMULATION' });
            continue;
          }

          // Envoyer l'email de rappel
          const mail = await sendReminderEmail(bk.name, bk.email, date.label, reste, paymentUrl);

          if (mail.ok) {
            marked.push(bk.id);   // marqueur appliqué plus tard sur une copie fraîche
            sent++;
          }

          results.push({ name: bk.name, email: bk.email, date: date.label, joursAvant: diff, reste,
                         sent: mail.ok, ...(mail.error ? { erreurEmail: mail.error } : {}) });
          console.log(`Rappel J-${diff} → ${bk.name} (${bk.email}) — ${reste}€ — ${date.label}`);
        }
      }
    }

    // ── Sauvegarde des marqueurs ────────────────────────────────
    // On relit Firebase juste avant d'écrire : entre-temps un skipper a pu
    // encaisser un solde. On applique uniquement les marqueurs sur cette
    // version fraîche, sans écraser les autres modifications.
    let markersSaved = false;
    if (marked.length && !dryRun) {
      const fresh = await firebaseGet(STORE_KEY);
      if (fresh) {
        const data2 = JSON.parse(fresh);
        const stamp = new Date().toISOString();
        for (const d of data2.dates) {
          for (const b of d.boats) {
            for (const bk of b.bookings) {
              if (marked.includes(bk.id)) {
                bk.reminder_sent    = true;
                bk.reminder_sent_at = stamp;
              }
            }
          }
        }
        markersSaved = await firebaseSet(STORE_KEY, JSON.stringify(data2));
      }
      if (!markersSaved) console.error('⚠️ Échec sauvegarde des marqueurs — risque de doublon demain');
    }

    return res.status(200).json({
      success: true,
      fenetre: `excursions dans 0 à ${horizon} jour(s)`,
      dryRun, sent, marques: marked.length, markersSaved, results, skipped,
    });

  } catch (err) {
    console.error('send-reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
