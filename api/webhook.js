// api/webhook.js — WooCommerce Webhook → Firebase
// Reçoit les commandes WooCommerce en temps réel et les injecte dans Firebase

import crypto from 'crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { credential } from 'firebase-admin';

// ── Firebase Admin init ────────────────────────────────────────
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

// ── Helpers ───────────────────────────────────────────────────
const STORE_KEY = 'panamax-v3';

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// Parse WooCommerce metadata
function getMeta(order, key) {
  const item = (order.meta_data || []).find(m => m.key === key);
  return item?.value || '';
}

// Format date label from a YYYY-MM-DD string
function labelFromDateStr(dateStr) {
  if (!dateStr) return null;
  const DAYS  = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return `${DAYS[d.getDay()]} ${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`;
}

// Convert WooCommerce order to Panamax booking
function orderToBooking(order) {
  const adults   = parseInt(getMeta(order, 'adult_number'))   || parseInt(getMeta(order, 'adults'))   || 1;
  const children = parseInt(getMeta(order, 'child_number'))   || parseInt(getMeta(order, 'children')) || 0;
  const date1    = getMeta(order, 'date_1') || getMeta(order, 'date_excursion') || '';
  const notes    = [
    getMeta(order, 'additional_informations'),
    getMeta(order, 'informations_complementaires'),
    getMeta(order, 'notes'),
  ].filter(Boolean).join(' | ');

  const P_AD = 115, P_CH = 95;
  const price = adults * P_AD + children * P_CH;

  const firstName = order.billing?.first_name || '';
  const lastName  = order.billing?.last_name  || '';
  const name      = `${firstName} ${lastName}`.trim() || `Commande #${order.id}`;
  const phone     = order.billing?.phone || '';
  const email     = order.billing?.email || '';

  return {
    id:            `woo-${order.id}-${uid()}`,
    woo_order_id:  order.id,
    name,
    phone,
    phone_prefix:  '+33',
    email,
    adults,
    children,
    source:        'woo',
    price,
    discount:      0,
    acompte_amount: 0,
    notes,
    status:        'confirmed',
    ts:            Date.now(),
    // Possible date from metadata
    _date_pref: date1,
  };
}

// ── Main handler ───────────────────────────────────────────────
export default async function handler(req, res) {

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify webhook signature ────────────────────────────
  const secret    = process.env.WOO_WEBHOOK_SECRET;
  const signature = req.headers['x-wc-webhook-signature'];

  if (secret && signature) {
    const body = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('base64');

    if (signature !== expected) {
      console.error('Webhook signature mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // ── 2. Parse order ─────────────────────────────────────────
  const order = req.body;
  if (!order || !order.id) {
    return res.status(400).json({ error: 'Invalid order payload' });
  }

  // Only process completed or processing orders
  if (!['completed', 'processing'].includes(order.status)) {
    return res.status(200).json({ message: `Order status "${order.status}" ignored` });
  }

  console.log(`Processing WooCommerce order #${order.id} — ${order.status}`);

  try {
    const db      = getDb();
    const docRef  = db.collection('panamax').doc(STORE_KEY);
    const snap    = await docRef.get();
    const data    = snap.exists ? snap.data().value : null;
    const current = data ? JSON.parse(data) : { dates: [], pending: [] };

    const booking  = orderToBooking(order);
    const dateLabel = labelFromDateStr(booking._date_pref);
    delete booking._date_pref;

    // ── 3. Find or create the date entry ─────────────────────
    let dateEntry = dateLabel
      ? current.dates.find(d => d.label === dateLabel)
      : null;

    if (dateLabel && !dateEntry) {
      // Create new date with both boats
      dateEntry = {
        id: uid(),
        label: dateLabel,
        boats: [
          { id: uid(), name: 'Aloes Vera', emoji: 'ferry',  bookings: [] },
          { id: uid(), name: 'Panamax',    emoji: 'boat',   bookings: [] },
        ],
      };
      current.dates.push(dateEntry);
    }

    if (dateEntry) {
      // Check if order already imported (idempotency)
      const alreadyExists = current.dates.some(d =>
        d.boats.some(b =>
          b.bookings.some(bk => bk.woo_order_id === order.id)
        )
      );

      if (alreadyExists) {
        return res.status(200).json({ message: `Order #${order.id} already imported` });
      }

      // Add to the boat with the most available spots (or first boat)
      const MAX_PAX = 12;
      const target = dateEntry.boats.reduce((best, boat) => {
        const used = boat.bookings.reduce((s, b) => s + b.adults + b.children, 0);
        const bestUsed = best.bookings.reduce((s, b) => s + b.adults + b.children, 0);
        return used < bestUsed ? boat : best;
      }, dateEntry.boats[0]);

      target.bookings.push(booking);

      // Update dates array
      current.dates = current.dates.map(d =>
        d.label !== dateEntry.label ? d : dateEntry
      );
    } else {
      // No date found — add to pending with label note
      booking.notes = `[Date WooCommerce non reconnue] ${booking.notes}`.trim();
      current.pending = [...(current.pending || []), { ...booking, dateId: null, boatId: null }];
    }

    // ── 4. Save to Firebase ───────────────────────────────────
    await docRef.set({ value: JSON.stringify(current), updatedAt: Date.now() });

    console.log(`Order #${order.id} imported to date: ${dateLabel || 'PENDING'}`);
    return res.status(200).json({
      success: true,
      order_id: order.id,
      date: dateLabel || 'pending',
    });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}

// Needed for raw body access (signature verification)
export const config = {
  api: {
    bodyParser: true,
  },
};
