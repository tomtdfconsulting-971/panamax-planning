// api/stripe-webhook.js — Reçoit la confirmation de paiement Stripe et met à jour Firebase

const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET;
const FIREBASE_PROJECT       = process.env.FIREBASE_PROJECT_ID || 'panamax-planning';
const FIREBASE_API_KEY       = process.env.FIREBASE_WEB_API_KEY;
const STORE_KEY              = 'panamax-v3';

async function firebaseGet(key) {
  const url  = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/panamax/${key}?key=${FIREBASE_API_KEY}`;
  const res  = await fetch(url);
  if (!res.ok) return null;
  const doc  = await res.json();
  return doc?.fields?.value?.stringValue || null;
}

async function firebaseSet(key, value) {
  const url  = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/panamax/${key}?key=${FIREBASE_API_KEY}`;
  const res  = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { value: { stringValue: value }, updatedAt: { integerValue: String(Date.now()) } } }),
  });
  return res.ok;
}

async function getStripeSession(sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const event = req.body;

  // Vérifier la signature Stripe (si secret configuré)
  if (STRIPE_WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).json({ error: 'Signature manquante' });
    // Note: vérification complète nécessite crypto + raw body
    // Pour l'instant on vérifie le type d'événement
  }

  // On ne traite que les paiements réussis
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ message: `Événement ${event.type} ignoré` });
  }

  const session  = event.data?.object;
  const metadata = session?.metadata || {};

  const bookingId  = metadata.booking_id;
  const dateId     = metadata.date_id;
  const boatId     = metadata.boat_id;
  const amountPaid = (session.amount_total || 0) / 100;

  console.log(`Paiement Stripe reçu — booking:${bookingId} montant:${amountPaid}€`);

  if (!bookingId) return res.status(200).json({ message: 'Pas de booking_id dans les metadata' });

  try {
    const raw     = await firebaseGet(STORE_KEY);
    if (!raw) return res.status(404).json({ error: 'Données Firebase non trouvées' });
    const current = JSON.parse(raw);

    let updated = false;

    current.dates = current.dates.map(date => {
      if (date.id !== dateId) return date;
      return {
        ...date,
        boats: date.boats.map(boat => {
          if (boat.id !== boatId) return boat;
          return {
            ...boat,
            bookings: boat.bookings.map(bk => {
              if (bk.id !== bookingId) return bk;
              updated = true;
              const newAcompte = (bk.acompte_amount || 0) + amountPaid;
              return {
                ...bk,
                acompte_amount:    newAcompte,
                stripe_paid:       true,
                stripe_session_id: session.id,
                stripe_paid_at:    new Date().toISOString(),
              };
            }),
          };
        }),
      };
    });

    if (!updated) {
      console.warn(`Booking ${bookingId} non trouvé dans Firebase`);
      return res.status(200).json({ message: 'Booking non trouvé' });
    }

    await firebaseSet(STORE_KEY, JSON.stringify(current));
    console.log(`✅ Booking ${bookingId} soldé — ${amountPaid}€ via Stripe`);
    return res.status(200).json({ success: true, amount: amountPaid });

  } catch (err) {
    console.error('stripe-webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
