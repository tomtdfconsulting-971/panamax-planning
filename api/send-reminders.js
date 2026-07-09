// api/send-reminders.js — Cron J-7 : envoie les rappels de paiement aux clients
// Déclenché automatiquement chaque jour à 8h00 par Vercel Cron

const FIREBASE_PROJECT  = process.env.FIREBASE_PROJECT_ID || 'panamax-planning';
const FIREBASE_API_KEY  = process.env.FIREBASE_WEB_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const EMAILJS_SERVICE   = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE  = process.env.EMAILJS_REMINDER_TEMPLATE_ID;
const EMAILJS_KEY       = process.env.EMAILJS_PUBLIC_KEY;
const STORE_KEY         = 'panamax-v3';

async function firebaseGet(key) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/panamax/${key}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const doc = await res.json();
  return doc?.fields?.value?.stringValue || null;
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
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      'payment_method_types[]':                                   'card',
      'mode':                                                     'payment',
      'success_url':                                              `${APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':                                               `${APP_URL}/payment-cancel`,
      'customer_email':                                           clientEmail || '',
      'line_items[0][price_data][currency]':                      'eur',
      'line_items[0][price_data][unit_amount]':                   String(Math.round(amount * 100)),
      'line_items[0][price_data][product_data][name]':            `Excursion Panamax — ${dateLabel}`,
      'line_items[0][price_data][product_data][description]':     `Solde de réservation pour ${clientName}`,
      'line_items[0][quantity]':                                  '1',
      'metadata[booking_id]':   bookingId,
      'metadata[date_id]':      dateId,
      'metadata[boat_id]':      boatId,
      'metadata[client_name]':  clientName,
      'metadata[date_label]':   dateLabel,
      'expires_at':             String(Math.floor(Date.now()/1000) + 7 * 24 * 3600), // expire dans 7 jours
    }).toString(),
  });
  const session = await res.json();
  return session.url || null;
}

async function sendReminderEmail(to_name, to_email, date, reste, paymentUrl) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  // Sécurité : seul Vercel Cron peut appeler cet endpoint
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const raw     = await firebaseGet(STORE_KEY);
    if (!raw) return res.status(200).json({ message: 'Aucune donnée' });
    const current = JSON.parse(raw);

    const today   = new Date();
    today.setHours(0, 0, 0, 0);
    const target  = new Date(today);
    target.setDate(today.getDate() + 7); // J+7

    let sent = 0;
    const results = [];

    for (const date of current.dates) {
      const dateObj = dateFromLabel(date.label);
      if (!dateObj) continue;

      // Vérifier si c'est J+7
      const diff = Math.round((dateObj - today) / (1000 * 60 * 60 * 24));
      if (diff !== 7) continue;

      for (const boat of date.boats) {
        for (const bk of boat.bookings) {
          // Ne pas renvoyer si déjà payé via Stripe
          if (bk.stripe_paid) continue;

          const reste = Math.max(0, bk.price - (bk.acompte_amount || 0) - (bk.solde_encaisse || 0));
          if (reste <= 0) continue;
          if (!bk.email) continue;

          // Générer le lien Stripe
          const paymentUrl = await createStripeLink(reste, bk.name, bk.email, date.label, bk.id, date.id, boat.id);
          if (!paymentUrl) continue;

          // Envoyer l'email de rappel
          const ok = await sendReminderEmail(bk.name, bk.email, date.label, reste, paymentUrl);

          results.push({ name: bk.name, email: bk.email, date: date.label, reste, sent: ok });
          if (ok) sent++;

          console.log(`Rappel J-7 → ${bk.name} (${bk.email}) — ${reste}€ — ${date.label}`);
        }
      }
    }

    return res.status(200).json({ success: true, sent, results });

  } catch (err) {
    console.error('send-reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
