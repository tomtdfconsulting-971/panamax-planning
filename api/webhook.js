// api/webhook.js — WooCommerce Webhook → Firebase (via REST API, no firebase-admin)
import crypto from 'crypto';

const STORE_KEY        = 'panamax-v3';
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'panamax-planning';
const FIREBASE_API_KEY = process.env.FIREBASE_WEB_API_KEY; // clé web publique Firebase

// ── Firebase REST helper ───────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function getMeta(order, ...keys) {
  for (const key of keys) {
    const item = (order.meta_data || []).find(m => m.key === key);
    if (item?.value) return item.value;
  }
  return '';
}

function labelFromDateStr(dateStr) {
  if (!dateStr) return null;
  // Handle YYYY-MM-DD format
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const DAYS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const d = new Date(year, month - 1, day);
  return `${DAYS[d.getDay()]} ${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`;
}

function orderToBooking(order) {
  // Noms de champs WooCommerce Panamax (avec fallbacks)
  const adults   = parseInt(getMeta(order, 'adult_number',  'nombre_adultes',  'adults',   'nb_adultes'))   || 1;
  const children = parseInt(getMeta(order, 'child_number',  'nombre_enfants',  'children', 'nb_enfants'))   || 0;
  const date1    = getMeta(order, 'date_1', 'date_privilegiee', 'date_preferentielle', 'date_excursion', 'date');
  const date2    = getMeta(order, 'date_2', 'seconde_date_possible', 'date_repli', 'date_alternative');
  const notes    = [
    getMeta(order, 'informations_complementaires', 'additional_informations', 'informations', 'notes', 'message'),
    date2 ? `Date de repli : ${date2}` : '',
  ].filter(Boolean).join(' | ');

  const P_AD = 115, P_CH = 95;
  const name  = `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || `Commande #${order.id}`;
  const phone = (order.billing?.phone || '').replace(/\s/g, '');
  const email = order.billing?.email || '';

  // Log pour debug
  console.log(`Order #${order.id} — adults:${adults} children:${children} date1:${date1} date2:${date2}`);

  return {
    id:            `woo-${order.id}-${uid()}`,
    woo_order_id:  order.id,
    name, phone, email,
    phone_prefix:  '+33',
    adults, children,
    source:        'woo',
    price:         adults * P_AD + children * P_CH,
    discount:      0,
    acompte_amount: 0,
    notes,
    status:        'confirmed',
    ts:            Date.now(),
    _date_pref:    date1,
  };
}

// ── Main handler ───────────────────────────────────────────────
export default async function handler(req, res) {

  // GET → test rapide
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Panamax webhook OK', method: 'POST required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Vérification signature ─────────────────────────────────
  const secret    = process.env.WOO_WEBHOOK_SECRET;
  const signature = req.headers['x-wc-webhook-signature'];

  if (secret && signature) {
    const body     = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    if (signature !== expected) {
      console.error('Signature invalide');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // ── Parse commande ─────────────────────────────────────────
  const order = req.body;

  // WordPress envoie un ping de test sans order.id lors de la création du webhook
  if (!order?.id) {
    console.log('Ping WordPress reçu — webhook actif');
    return res.status(200).json({ success: true, message: 'Webhook Panamax actif' });
  }

  if (!['completed', 'processing'].includes(order.status)) {
    return res.status(200).json({ message: `Statut "${order.status}" ignoré` });
  }

  console.log(`WooCommerce order #${order.id} reçue — statut: ${order.status}`);

  try {
    // ── Lire données Firebase ──────────────────────────────
    const raw     = await firebaseGet(STORE_KEY);
    const current = raw ? JSON.parse(raw) : { dates: [], pending: [] };

    // ── Vérifier doublon ───────────────────────────────────
    const alreadyExists = current.dates.some(d =>
      d.boats.some(b => b.bookings.some(bk => bk.woo_order_id === order.id))
    );
    if (alreadyExists) {
      return res.status(200).json({ message: `Commande #${order.id} déjà importée` });
    }

    const booking    = orderToBooking(order);
    const dateLabel  = labelFromDateStr(booking._date_pref);
    delete booking._date_pref;

    if (dateLabel) {
      // Chercher ou créer la date
      let dateEntry = current.dates.find(d => d.label === dateLabel);
      if (!dateEntry) {
        dateEntry = {
          id: uid(), label: dateLabel,
          boats: [
            { id: uid(), name: 'Aloes Vera', emoji: 'ferry',  bookings: [] },
            { id: uid(), name: 'Panamax',    emoji: 'boat',   bookings: [] },
          ],
        };
        current.dates.push(dateEntry);
      }

      // Ajouter au bateau avec le plus de places libres
      const MAX_PAX = 12;
      const target = dateEntry.boats.reduce((best, boat) => {
        const usedBest = best.bookings.reduce((s,b)=>s+b.adults+b.children, 0);
        const usedBoat = boat.bookings.reduce((s,b)=>s+b.adults+b.children, 0);
        return usedBoat < usedBest ? boat : best;
      }, dateEntry.boats[0]);

      target.bookings.push(booking);
      current.dates = current.dates.map(d => d.label === dateLabel ? dateEntry : d);
      console.log(`Réservation ajoutée → ${dateLabel}`);
    } else {
      // Pas de date reconnue → file d'attente
      booking.notes = `[Date non reconnue dans WooCommerce] ${booking.notes}`.trim();
      current.pending = [...(current.pending || []), booking];
      console.log(`Réservation en attente (pas de date)`);
    }

    // ── Sauvegarder dans Firebase ──────────────────────────
    const saved = await firebaseSet(STORE_KEY, JSON.stringify(current));
    if (!saved) throw new Error('Échec sauvegarde Firebase');

    // ── Notifier l'admin via Telegram ────────────────────
    try {
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
      if (BOT_TOKEN && CHAT_ID) {
        const msg = `🌐 Nouvelle commande WooCommerce\n👤 ${booking.name}\n📅 ${dateLabel || 'Date non reconnue'}\n👥 ${booking.adults} adulte(s)${booking.children ? ` + ${booking.children} enfant(s)` : ''}\n💰 ${booking.price}€\n✉️ ${booking.email || 'Pas d\'email'}`;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: CHAT_ID, text: msg }),
        });
      }
    } catch(e) { console.error('Telegram notify error:', e.message); }

    return res.status(200).json({
      success:  true,
      order_id: order.id,
      date:     dateLabel || 'en attente',
    });

  } catch (err) {
    console.error('Erreur webhook:', err.message);
    return res.status(500).json({ error: 'Erreur interne', detail: err.message });
  }
}
