// api/stripe-checkout.js — Génère un lien de paiement Stripe pour le solde d'une réservation

const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
const APP_URL              = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://panamax-planning.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { amount, clientName, clientEmail, dateLabel, bookingId, dateId, boatId } = req.body;

  if (!amount || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
  if (!STRIPE_SECRET_KEY)     return res.status(500).json({ error: 'Clé Stripe manquante' });

  try {
    // Créer une session Stripe Checkout
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]':           'card',
        'mode':                             'payment',
        'success_url':                      `${APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url':                       `${APP_URL}/payment-cancel`,
        'customer_email':                   clientEmail || '',
        'line_items[0][price_data][currency]':                    'eur',
        'line_items[0][price_data][unit_amount]':                 String(Math.round(amount * 100)),
        'line_items[0][price_data][product_data][name]':          `Excursion Panamax — ${dateLabel || 'Date à confirmer'}`,
        'line_items[0][price_data][product_data][description]':   `Solde de réservation pour ${clientName || 'Client'}`,
        'line_items[0][quantity]':                                '1',
        'metadata[booking_id]':             bookingId || '',
        'metadata[date_id]':                dateId    || '',
        'metadata[boat_id]':                boatId    || '',
        'metadata[client_name]':            clientName || '',
        'metadata[date_label]':             dateLabel  || '',
      }).toString(),
    });

    const session = await response.json();

    if (!response.ok) {
      console.error('Stripe error:', session);
      return res.status(400).json({ error: session.error?.message || 'Erreur Stripe' });
    }

    return res.status(200).json({
      url:        session.url,
      session_id: session.id,
    });

  } catch (err) {
    console.error('stripe-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
