import { useState, useEffect, useCallback } from "react";

// ── Constants ──────────────────────────────────────────────────
const MAX_CAP   = 12;
const P_AD      = 115;
const P_CH      = 95;
const PIN       = "1234";
const STORE_KEY          = "panamax-v3";
const STORE_KEY_SKIPPERS = "panamax-v3-skippers";

// ── EmailJS config ─────────────────────────────────────────────
const EMAILJS_SERVICE_ID  = "service_h2mdqfs";
const EMAILJS_TEMPLATE_ID = "template_2ywr08e";  // Mail de confirmation
const EMAILJS_PUBLIC_KEY  = "RFeCuLmI9rtEy4Y0f";
const TEAL      = "#1A5F7A";
const CORAL     = "#E8673A";
const DARK      = "#0D3D52";
const GREEN     = "#1E8449";
const ORANGE    = "#E67E22";

const DAYS_SHORT = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const DAYS_LONG  = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const MONTHS     = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const DEFAULT_SOURCES = {
  luc:   { label:"Luc",   color:"#1A5F7A" },
  lud:   { label:"Lud",   color:"#2471A3" },
  cdi:   { label:"CDI",   color:"#C0392B" },
  cam:   { label:"Cam",   color:"#1E8449" },
  ici:   { label:"Ici",   color:"#7D3C98" },
  woo:   { label:"Web",   color:"#8E44AD" },
  autre: { label:"Autre", color:"#7F8C8D" },
};

// SOURCES is a module-level variable, updated by useData hook
let SOURCES = { ...DEFAULT_SOURCES };

// ── Phone prefixes & validation ───────────────────────────────
const PHONE_PREFIXES = [
  { code: "+590", flag: "🇬🇵", label: "Guadeloupe",     len: [9],       ex: "690 62 71 22" },
  { code: "+596", flag: "🇲🇶", label: "Martinique",     len: [9],       ex: "696 00 00 00" },
  { code: "+33",  flag: "🇫🇷", label: "France",         len: [9],       ex: "6 12 34 56 78" },
  { code: "+32",  flag: "🇧🇪", label: "Belgique",       len: [8,9,10],  ex: "470 12 34 56" },
  { code: "+41",  flag: "🇨🇭", label: "Suisse",         len: [9],       ex: "79 123 45 67" },
  { code: "+1",   flag: "🇺🇸", label: "USA/Canada",     len: [10],      ex: "514 123 4567" },
  { code: "+44",  flag: "🇬🇧", label: "Royaume-Uni",    len: [10],      ex: "7911 123456" },
  { code: "+49",  flag: "🇩🇪", label: "Allemagne",      len: [10,11],   ex: "151 12345678" },
  { code: "+31",  flag: "🇳🇱", label: "Pays-Bas",       len: [9],       ex: "6 12345678" },
  { code: "+39",  flag: "🇮🇹", label: "Italie",         len: [9,10],    ex: "312 345 6789" },
  { code: "+34",  flag: "🇪🇸", label: "Espagne",        len: [9],       ex: "612 345 678" },
  { code: "+351", flag: "🇵🇹", label: "Portugal",       len: [9],       ex: "912 345 678" },
  { code: "+974", flag: "🇶🇦", label: "Qatar",          len: [8],       ex: "5012 3456" },
  { code: "+971", flag: "🇦🇪", label: "Émirats",        len: [9],       ex: "50 123 4567" },
  { code: "+61",  flag: "🇦🇺", label: "Australie",      len: [9],       ex: "412 345 678" },
  { code: "+55",  flag: "🇧🇷", label: "Brésil",         len: [10,11],   ex: "11 91234-5678" },
];

function validatePhone(prefix, number) {
  const digits = number.replace(/[^0-9]/g, "");
  if (!digits) return null; // empty = ok (optional field)
  const found = PHONE_PREFIXES.find(p => p.code === prefix);
  if (!found) return true;
  return found.len.includes(digits.length);
}

// ── Utils ──────────────────────────────────────────────────────
const uid      = () => Math.random().toString(36).slice(2, 9);

// ── Générer un lien de paiement Stripe ────────────────────────
async function generateStripeLink({ amount, clientName, clientEmail, dateLabel, bookingId, dateId, boatId }) {
  try {
    const res = await fetch('/api/stripe-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, clientName, clientEmail, dateLabel, bookingId, dateId, boatId }),
    });
    const data = await res.json();
    if (data.url) return data.url;
    console.error('Stripe error:', data.error);
    return null;
  } catch (err) {
    console.error('generateStripeLink error:', err);
    return null;
  }
}

// ── Send Telegram notification to admin ───────────────────────
async function sendTelegramNotif(message) {
  try {
    await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  } catch (err) {
    console.error('Telegram error:', err);
  }
}

// ── Send confirmation email to client via EmailJS ─────────────
async function sendConfirmationEmail(booking, dateLabel) {
  try {
    if (!booking.email) return; // pas d'email → on skip silencieusement

    const adults   = booking.adults   || 0;
    const children = booking.children || 0;
    const price    = booking.price    || 0;
    const discount = booking.discount || 0;
    const acompte  = booking.acompte_amount || 0;
    const reste    = Math.max(0, price - acompte);

    // Build passengers line
    let passagers = `${adults} adulte${adults > 1 ? "s" : ""}`;
    if (children > 0) passagers += ` + ${children} enfant${children > 1 ? "s" : ""}`;

    // Build price detail lines
    const ligneRemise  = discount > 0 ? `🎁 Remise commerciale : -${discount}€` : "";
    const ligneAcompte = acompte > 0  ? `✅ Acompte versé : ${acompte}€`         : "✅ Acompte versé : 0€";
    const ligneReste   = `⏳ Reste à régler le jour J : ${reste}€`;

    const templateParams = {
      to_name:    booking.name,
      to_email:   booking.email,
      date:       dateLabel || "À confirmer",
      passagers,
      montant:    `${price}€`,
      remise:     ligneRemise,
      acompte:    ligneAcompte,
      reste:      ligneReste,
      notes:      booking.notes ? `📝 ${booking.notes}` : "",
      pdf_url:    "https://panamax-planning.vercel.app/itineraire-panamax.pdf",
      reply_to:   "contact@panamaxexcursions.com",
    };

    const response = await fetch(`https://api.emailjs.com/api/v1.0/email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id:  EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id:     EMAILJS_PUBLIC_KEY,
        template_params: templateParams,
      }),
    });

    if (response.ok) {
      console.log("Email de confirmation envoyé à", booking.email);
    } else {
      const err = await response.text();
      console.error("EmailJS error:", err);
    }
  } catch (err) {
    console.error("sendConfirmationEmail error:", err);
  }
}
const fullPhone = (bk) => {
  if (!bk.phone) return null;
  const digits = bk.phone.replace(/[^0-9]/g, "");
  const prefix = (bk.phone_prefix || "+33").replace("+", "");
  // Remove leading 0 if present (e.g. 0612... → 612...)
  const clean = digits.startsWith("0") ? digits.slice(1) : digits;
  return `+${prefix}${clean}`;
};
const boatPax  = b  => b.bookings.reduce((s, bk) => s + bk.adults + bk.children, 0);
const boatRev  = b  => b.bookings.reduce((s, bk) => s + bk.price, 0);
const fmtEur   = n  => n.toLocaleString("fr") + "€";
const spots    = b  => Math.max(0, MAX_CAP - boatPax(b));
const pct      = b  => Math.min((boatPax(b) / MAX_CAP) * 100, 100);
const barColor = b  => pct(b) >= 100 ? CORAL : pct(b) > 70 ? ORANGE : GREEN;

// Format a JS Date → "Mercredi 29/05"
function labelFromDate(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  return `${DAYS_LONG[d.getDay()]} ${day}/${mon}`;
}

// Parse "Mercredi 29/05" → JS Date (current year)
function dateFromLabel(label) {
  const m = label.match(/(\d{1,2})\/(\d{2})/);
  if (!m) return null;
  return new Date(new Date().getFullYear(), +m[2] - 1, +m[1]);
}

// Make a fresh two-boat date entry
function makeDateEntry(label) {
  return {
    id: uid(), label,
    boats: [
      { id: uid(), name: "Aloes Vera", emoji: "ferry", bookings: [] },
      { id: uid(), name: "Panamax",    emoji: "boat",  bookings: [] },
    ],
  };
}

// WhatsApp export
function toWA(entry) {
  const lines = [`Planning Panamax: ${P_AD}€/ad ${P_CH}€/enf`, "……………………", entry.label];
  for (const boat of entry.boats) {
    const r = spots(boat);
    const icon = boat.emoji === "ferry" ? "🛥️" : "🚤";
    lines.push(`${icon}${boat.name} ${r <= 0 ? "Full 💥" : `R${r}👈👈👈`}`);
    for (const bk of boat.bookings) {
      const ps  = bk.children ? `${bk.adults}+${bk.children}` : `${bk.adults}`;
      const src = bk.source !== "autre" ? bk.source : "";
      lines.push([ps, bk.name, src, bk.phone, `${bk.price}€`, bk.notes].filter(Boolean).join(" "));
    }
  }
  return lines.join("\n");
}

// WhatsApp import parser
function parseWA(text) {
  const lines  = text.split("\n").map(l => l.trim()).filter(Boolean);
  const dayRe  = /^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+\d{1,2}\/\d{2}/i;
  const result = [];
  let d = null, b = null;
  for (const line of lines) {
    if (/[.…─]{3}/.test(line) || /€\/ad/i.test(line) || line.startsWith("Planning")) continue;
    if (dayRe.test(line)) {
      const label = line.replace(/[^\w\s/àâäéèêëîïôùûüç'-]/gi, "").trim();
      d = { id: uid(), label, boats: [] }; result.push(d); b = null; continue;
    }
    if (d && (line.includes("🛥") || line.includes("🚤"))) {
      const isA = /alo[eè]s/i.test(line);
      b = { id: uid(), name: isA ? "Aloes Vera" : "Panamax", emoji: isA ? "ferry" : "boat", bookings: [] };
      d.boats.push(b); continue;
    }
    if (b && /^\d/.test(line)) {
      const m = line.match(/^(\d+)(?:\+(\d+))?\s+(.+)/); if (!m) continue;
      const adults = +m[1], children = m[2] ? +m[2] : 0; let rest = m[3];
      const pm  = rest.match(/(\d+)€/);     const price  = pm  ? +pm[1]    : 0;    if (pm)  rest = rest.replace(pm[0], "");
      const phm = rest.match(/(\+?\d[\d\s]{7,14})/); const phone  = phm ? phm[1].trim() : ""; if (phm) rest = rest.replace(phm[0], "");
      const sm  = rest.match(/\b(luc|lud|cdi|cam|ici)\b/i); const source = sm  ? sm[1].toLowerCase() : "autre"; if (sm) rest = rest.replace(new RegExp("\\b" + sm[0] + "\\b", "i"), "");
      const nm  = rest.match(/\(([^)]+)\)/); const note1  = nm  ? nm[1]    : "";   if (nm)  rest = rest.replace(nm[0], "");
      const emojis = [...rest.matchAll(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu)].map(e => e[0]).join("");
      const name = rest.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "").replace(/[^a-zA-Z0-9\s'\-&àâäéèêëîïôùûüç]/gi, "").trim().replace(/\s+/g, " ");
      b.bookings.push({ id: uid(), adults, children, name, source, phone, price, notes: [note1, emojis].filter(Boolean).join(" "), status: "confirmed", ts: Date.now() });
    }
  }
  return result;
}

// ── Shared storage hook ────────────────────────────────────────
const DEFAULT_SKIPPERS_DATA = {
  skippers: [
    { id: "ludo",   name: "Ludo",   pin: "0000", color: "#2471A3", active: true },
    { id: "camille",name: "Camille",pin: "1111", color: "#8E44AD", active: true },
  ],
  planning: {}, // { "dateLabel": { "aloes": "ludo", "panamax": "camille" } }
};

function useData() {
  const [data,     setData]     = useState({ dates: [], pending: [] });
  const [sources,  setSources]  = useState({ ...DEFAULT_SOURCES });
  const [skData,   setSkData]   = useState({ ...DEFAULT_SKIPPERS_DATA });
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let loadedMain = false, loadedSources = false, loadedSkippers = false;
    const checkReady = () => { if (loadedMain && loadedSources && loadedSkippers) setLoading(false); };

    // ── Real-time listener for planning data ──────────────
    const unsubData = window.storage.subscribe(STORE_KEY, (r) => {
      try {
        const parsed = JSON.parse(r.value);
        setData(parsed);
      } catch {}
      if (!loadedMain) { loadedMain = true; checkReady(); }
    });

    // ── Real-time listener for sources ────────────────────
    const unsubSources = window.storage.subscribe(STORE_KEY + "-sources", (r) => {
      try {
        const parsed = JSON.parse(r.value);
        setSources(parsed);
        SOURCES = parsed;
      } catch {}
      if (!loadedSources) { loadedSources = true; checkReady(); }
    });

    // ── Real-time listener for skippers ──────────────────
    const unsubSkippers = window.storage.subscribe(STORE_KEY_SKIPPERS, (r) => {
      try { setSkData(JSON.parse(r.value)); } catch {}
      if (!loadedSkippers) { loadedSkippers = true; checkReady(); }
    });

    // Fallback: if no data in Firebase yet, mark as loaded after 3s
    const fallback = setTimeout(() => {
      loadedMain = true; loadedSources = true; loadedSkippers = true; checkReady();
    }, 3000);

    return () => {
      if (unsubData)     unsubData();
      if (unsubSources)  unsubSources();
      if (unsubSkippers) unsubSkippers();
      clearTimeout(fallback);
    };
  }, []);

  const reload = useCallback(() => {}, []); // no-op, real-time handles it

  const save = async (next) => {
    setData(next); // optimistic update
    try { await window.storage.set(STORE_KEY, JSON.stringify(next), true); } catch {}
  };

  const saveSources = async (next) => {
    setSources(next);
    SOURCES = next;
    try { await window.storage.set(STORE_KEY + "-sources", JSON.stringify(next), true); } catch {}
  };

  const saveSkData = async (next) => {
    setSkData(next);
    try { await window.storage.set(STORE_KEY_SKIPPERS, JSON.stringify(next), true); } catch {}
  };

  return { data, save, sources, saveSources, skData, saveSkData, loading, reload };
}

// ── Small UI pieces ────────────────────────────────────────────
const Row = ({ children, gap = 12, style = {} }) => (
  <div style={{ display: "flex", alignItems: "center", gap, ...style }}>{children}</div>
);

const Grid = ({ cols, gap = 12, children, style = {} }) => (
  <div style={{ display: "grid", gridTemplateColumns: cols, gap, ...style }}>{children}</div>
);

const Chip = ({ bg, color, children }) => (
  <span style={{ background: bg, color, fontSize: 11, padding: "2px 9px", borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>{children}</span>
);

function Btn({ children, onClick, variant = "primary", small, disabled, full, style = {} }) {
  const base = { borderRadius: 8, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", border: "none", opacity: disabled ? 0.45 : 1, fontSize: small ? 12 : 13, padding: small ? "5px 12px" : "10px 20px", width: full ? "100%" : undefined };
  const vars = { primary: { background: TEAL, color: "#fff" }, danger: { background: CORAL, color: "#fff" }, ghost: { background: "#eef3f5", color: "#444" }, success: { background: GREEN, color: "#fff" } };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...vars[variant], ...style }}>{children}</button>;
}

const Label = ({ children }) => <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 3 }}>{children}</label>;

const Counter = ({ label, value, onChange, min = 0, max = 12, sublabel }) => (
  <div>
    {label && <Label>{label}</Label>}
    <div style={{ display: "flex", alignItems: "center", gap: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => onChange(Math.max(min, value - 1))}
        style={{ width: 48, height: 48, background: value <= min ? "#f5f5f5" : "#EBF7FA", border: "none", cursor: value <= min ? "not-allowed" : "pointer", fontSize: 24, fontWeight: 700, color: value <= min ? "#ccc" : TEAL, flexShrink: 0, touchAction:"manipulation" }}>
        −
      </button>
      <div style={{ flex: 1, textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: DARK }}>{value}</div>
        {sublabel && <div style={{ fontSize: 10, color: "#aaa", marginTop: -2 }}>{sublabel}</div>}
      </div>
      <button onClick={() => onChange(Math.min(max, value + 1))}
        style={{ width: 48, height: 48, background: value >= max ? "#f5f5f5" : "#EBF7FA", border: "none", cursor: value >= max ? "not-allowed" : "pointer", fontSize: 24, fontWeight: 700, color: value >= max ? "#ccc" : TEAL, flexShrink: 0, touchAction:"manipulation" }}>
        +
      </button>
    </div>
  </div>
);
const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 7, fontSize: 14, boxSizing: "border-box", background: "#fff", outline: "none", maxWidth: "100%", display: "block" };

const FInput  = ({ label, ...p }) => <div><Label>{label}</Label><input  style={inputStyle} {...p} /></div>;

// Price breakdown helper
const calcTotal = (f) => Math.max(0, f.adults * P_AD + f.children * P_CH - (f.discount || 0));
const calcReste = (f) => Math.max(0, calcTotal(f) - (f.acompte_amount || 0));

const PriceBreakdown = ({ form }) => {
  const baseAdults   = form.adults * P_AD;
  const baseChildren = form.children * P_CH;
  const discount     = form.discount || 0;
  const total        = calcTotal(form);
  const acompte      = form.acompte_amount || 0;
  const reste        = calcReste(form);
  return (
    <div style={{ background: "#F0F8FB", borderRadius: 12, padding: "14px 16px", border: `1px solid ${TEAL}20`, boxSizing:"border-box", width:"100%", overflowX:"hidden" }}>
      <div style={{ fontWeight: 700, color: TEAL, fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Détail du prix</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        {form.adults > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
            <span>{form.adults} adulte(s) × {P_AD}€</span>
            <span style={{ fontWeight: 600 }}>{fmtEur(baseAdults)}</span>
          </div>
        )}
        {form.children > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
            <span>{form.children} enfant(s) × {P_CH}€</span>
            <span style={{ fontWeight: 600 }}>{fmtEur(baseChildren)}</span>
          </div>
        )}
        {discount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", color: GREEN }}>
            <span>Remise commerciale</span>
            <span style={{ fontWeight: 600 }}>−{fmtEur(discount)}</span>
          </div>
        )}
        <div style={{ height: 1, background: `${TEAL}20`, margin: "4px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", color: DARK, fontWeight: 800, fontSize: 15 }}>
          <span>Total</span>
          <span style={{ color: TEAL }}>{fmtEur(total)}</span>
        </div>
        {acompte > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#555", fontSize: 13 }}>
              <span>Acompte versé</span>
              <span style={{ fontWeight: 600, color: "#888" }}>−{fmtEur(acompte)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14, borderTop: `1px dashed ${CORAL}50`, paddingTop: 6, marginTop: 2 }}>
              <span style={{ color: reste === 0 ? GREEN : CORAL }}>Reste à payer</span>
              <span style={{ color: reste === 0 ? GREEN : CORAL }}>{reste === 0 ? "✅ Soldé" : fmtEur(reste)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Phone input with prefix selector + validation
const PhoneInput = ({ label="Téléphone client", prefixKey, onPrefixChange, value, onChange }) => {
  const isValid = validatePhone(prefixKey, value);
  const isInvalid = isValid === false;
  const found = PHONE_PREFIXES.find(p => p.code === prefixKey) || PHONE_PREFIXES[0];
  return (
    <div>
      {label && <Label>{label}</Label>}
      <div style={{ display:"flex", gap:0, border:`1.5px solid ${isInvalid ? CORAL : "#ddd"}`, borderRadius:7, overflow:"hidden", background:"#fff", width:"100%", boxSizing:"border-box" }}>
        <select value={prefixKey} onChange={e => onPrefixChange(e.target.value)}
          style={{ border:"none", background:"#F8FBFC", padding:"10px 8px", fontSize:13, cursor:"pointer", flexShrink:0, outline:"none", color:DARK, fontWeight:600, maxWidth:"45%" }}>
          {PHONE_PREFIXES.map(p => (
            <option key={p.code} value={p.code}>{p.flag} {p.code}</option>
          ))}
        </select>
        <div style={{ width:1, background:"#eee", flexShrink:0 }}/>
        <input type="tel" value={value} onChange={e => onChange(e.target.value)}
          placeholder={found.ex}
          style={{ border:"none", padding:"10px 10px", fontSize:13, flex:1, outline:"none", background:"transparent", minWidth:0 }} />
      </div>
      {isInvalid && (
        <div style={{ fontSize:11, color:CORAL, marginTop:4, display:"flex", alignItems:"center", gap:4 }}>
          ⚠️ Numéro invalide pour {found.flag} {found.label} ({found.len.join(" ou ")} chiffres attendus)
        </div>
      )}
    </div>
  );
};
const FSelect = ({ label, children, ...p }) => <div><Label>{label}</Label><select style={inputStyle} {...p}>{children}</select></div>;

// Capacity bar (used in admin)
const CapBar = ({ boat }) => {
  const p = pct(boat);
  return (
    <div>
      <Row style={{ justifyContent: "space-between", fontSize: 11, color: "#888", marginBottom: 3 }}>
        <span>{boatPax(boat)}/{MAX_CAP}</span>
        <span style={{ fontWeight: 700, color: p >= 100 ? CORAL : GREEN }}>{p >= 100 ? "COMPLET 🚫" : `${spots(boat)} libre(s)`}</span>
      </Row>
      <div style={{ height: 5, borderRadius: 3, background: "#eef3f5", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${p}%`, background: barColor(boat), borderRadius: 3 }} />
      </div>
    </div>
  );
};

// Booking form (used in admin and reseller)
const BLANK = { adults: 2, children: 0, name: "", source: "", phone_prefix: "+33", phone: "", email: "", price: P_AD * 2, discount: 0, acompte_amount: 0, notes: "" };

function BookingForm({ form, set, onSave, onCancel, title, admin }) {
  const upd = (k, v) => set(f => ({ ...f, [k]: v }));
  return (
    <div style={{ background: "#F0F8FB", border: `1px solid ${TEAL}40`, borderRadius: 10, padding: 16, margin: "10px 0" }}>
      <div style={{ fontWeight: 700, color: TEAL, fontSize: 13, marginBottom: 14 }}>{title}</div>
      <Grid cols={`repeat(${admin ? 4 : 3},1fr)`} gap={10} style={{ marginBottom: 12 }}>
        <FInput label="Adultes" type="number" min="0" value={form.adults}
          onChange={e => { const v = Math.max(0, +e.target.value); upd("adults", v); upd("price", v * P_AD + form.children * P_CH); }} />
        <FInput label="Enfants" type="number" min="0" value={form.children}
          onChange={e => { const v = Math.max(0, +e.target.value); upd("children", v); upd("price", form.adults * P_AD + v * P_CH); }} />
        <FSelect label="Source" value={form.source} onChange={e => upd("source", e.target.value)}>
          <option value="">— Sélectionner —</option>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </FSelect>
        {admin && (
          <div>
            <Label>Prix €</Label>
            <Row gap={4}>
              <input type="number" style={{ ...inputStyle, flex: 1 }} value={form.price} onChange={e => upd("price", Math.max(0, +e.target.value))} />
              <button onClick={() => upd("price", form.adults * P_AD + form.children * P_CH)}
                style={{ background: TEAL, color: "#fff", border: "none", borderRadius: 5, padding: "0 8px", cursor: "pointer", fontSize: 10, fontWeight: 700, height: 36, flexShrink: 0 }}>Auto</button>
            </Row>
          </div>
        )}
      </Grid>
      <Grid cols={admin ? "2fr 1fr 1fr" : "1fr 1fr"} gap={10} style={{ marginBottom: 14 }}>
        <FInput label="Nom du client" value={form.name} onChange={e => upd("name", e.target.value)} placeholder="Nom, prénom..." />
        <FInput label="Téléphone"     value={form.phone} onChange={e => upd("phone", e.target.value)} placeholder="+33..." />
        {admin && <FInput label="Notes" value={form.notes} onChange={e => upd("notes", e.target.value)} placeholder="🎂 remarques..." />}
      </Grid>
      <Row gap={8}>
        <Btn onClick={onSave} disabled={!form.name.trim() || form.adults + form.children === 0}>Enregistrer</Btn>
        <Btn variant="ghost" onClick={onCancel}>Annuler</Btn>
        {admin && <span style={{ marginLeft: "auto", fontSize: 12, color: "#999" }}>Tarif : {form.adults * P_AD + form.children * P_CH}€</span>}
      </Row>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// RESELLER CALENDAR PORTAL
// ════════════════════════════════════════════════════════════════
function ResellerPortal({ data, save }) {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [step,  setStep]  = useState("cal"); // cal | boat | form | ok | mes-resa | edit-resa
  const [selDate,       setSelDate]       = useState(null);
  const [selBoat,       setSelBoat]       = useState(null);
  const [form,          setForm]          = useState({ ...BLANK });
  const [editingPending, setEditingPending] = useState(null);
  const [editForm,       setEditForm]      = useState({ ...BLANK });
  const [delPending,     setDelPending]    = useState(null);
  const [identity,       setIdentity]      = useState(null); // source key of identified reseller
  const [viewMode,  setViewMode]  = useState("week"); // "month" | "week"
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d; // Start from today
  });

  const reset = () => { setStep("cal"); setSelDate(null); setSelBoat(null); setForm({ ...BLANK }); };

  // Build a lookup: "YYYY-M-D" → real date entry
  const byDay = {};
  for (const entry of data.dates) {
    const d = dateFromLabel(entry.label);
    if (!d) continue;
    byDay[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`] = entry;
  }

  // For any cell, return real entry or a virtual one (both boats at full capacity)
  const entryForDay = (cell) => {
    const key = `${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`;
    if (byDay[key]) return byDay[key];
    return {
      id: null,
      label: labelFromDate(cell),
      _virtual: true,
      boats: [
        { id: "v-aloes-" + key, name: "Aloes Vera", emoji: "ferry",  bookings: [] },
        { id: "v-panamax-" + key, name: "Panamax",  emoji: "boat",   bookings: [] },
      ],
    };
  };

  // Build calendar grid (Mon=0 … Sun=6)
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  let startDow = firstDay.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon-based
  const cells = Array(startDow).fill(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  // Submit booking
  const submit = () => {
    let nextData = data;
    let dateId   = selDate.id;
    let boatId   = selBoat.id;

    if (selDate._virtual) {
      const newEntry = makeDateEntry(selDate.label);
      const targetBoat = newEntry.boats.find(b => b.name === selBoat.name);
      dateId   = newEntry.id;
      boatId   = targetBoat ? targetBoat.id : newEntry.boats[0].id;
      nextData = { ...data, dates: [...data.dates, newEntry] };
    }

    // Booking confirmed directly — no admin validation needed
    const newBooking = {
      ...form,
      id: uid(), dateId, boatId,
      price: form.adults * P_AD + form.children * P_CH,
      status: "confirmed",
      ts: Date.now(),
    };

    nextData = {
      ...nextData,
      dates: nextData.dates.map(d => d.id !== dateId ? d : {
        ...d, boats: d.boats.map(b => b.id !== boatId ? b : {
          ...b, bookings: [...b.bookings, newBooking]
        })
      })
    };

    save(nextData);
    // Send confirmation email to client
    const bkPrice = form.adults*P_AD+form.children*P_CH;
    sendConfirmationEmail({ ...form, price: bkPrice }, selDate?.label || "");
    // Notify admin via Telegram
    sendTelegramNotif(`🆕 Nouvelle réservation\n📅 ${selDate?.label || ""}\n👤 ${form.name}\n👥 ${form.adults} adulte(s)${form.children ? ` + ${form.children} enfant(s)` : ""}\n💰 ${bkPrice}€${form.acompte_amount > 0 ? ` · Acompte ${form.acompte_amount}€` : ""}\n👥 Via : ${SOURCES[form.source]?.label || form.source || "?"}`);
    setStep("ok");
  };

  // ── Success screen ─────────────────────────
  if (step === "ok") return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 40, textAlign: "center", maxWidth: 420, width: "100%" }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>✅</div>
        <h2 style={{ color: TEAL, margin: "0 0 8px" }}>Réservation validée ! ✅</h2>
        <p style={{ color: "#666", lineHeight: 1.7, marginBottom: 24 }}>Votre réservation est confirmée. Un email de confirmation vous a été envoyé.</p>
        <div style={{ background: "#F0F8FB", borderRadius: 12, padding: 16, marginBottom: 24, textAlign: "left", fontSize: 14, lineHeight: 2, border: `1px solid ${TEAL}20` }}>
          <div>📅 <strong>{selDate?.label}</strong></div>
          <div>{selBoat?.name === "Aloes Vera" ? "🛥️" : "🚤"} <strong>{selBoat?.name === "Aloes Vera" ? "Aloès Vera" : "Panamax"}</strong></div>
          <div>👥 {form.children ? `${form.adults} adulte(s) + ${form.children} enfant(s)` : `${form.adults} adulte(s)`}</div>
          <div>👤 {form.name}</div>
          {form.phone && <div>📞 {form.phone}</div>}
          <div style={{ color: TEAL, fontWeight: 700 }}>💰 {fmtEur(form.adults * P_AD + form.children * P_CH)}</div>
        </div>
        <Btn full onClick={reset} style={{ padding: 14, fontSize: 15 }}>+ Nouvelle réservation</Btn>
      </div>
    </div>
  );

  // ── Boat selector ──────────────────────────
  if (step === "boat" && selDate) return (
    <div style={{ flex: 1, padding: "0 20px 40px", maxWidth: 540, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <button onClick={() => setStep("cal")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", borderRadius: 20, padding: "7px 18px", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
        ← Retour au calendrier
      </button>
      <div style={{ background: "#fff", borderRadius: 20, padding: 24 }}>
        <p style={{ fontSize: 12, color: "#aaa", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: 1 }}>Date sélectionnée</p>
        <h2 style={{ margin: "0 0 22px", color: DARK }}>📅 {selDate.label}</h2>
        <Grid cols="1fr" gap={14}>
          {selDate.boats.map(boat => {
            const r = spots(boat);
            const p = pct(boat);
            const full = r <= 0;
            const bc = barColor(boat);
            const icon = boat.name === "Aloes Vera" ? "🛥️" : "🚤";
            const displayName = boat.name === "Aloes Vera" ? "Aloès Vera" : boat.name;
            return (
              <button key={boat.id} onClick={() => { if (!full) { setSelBoat(boat); setStep("form"); } }} disabled={full}
                style={{ border: `2px solid ${full ? "#eee" : TEAL}`, borderRadius: 16, padding: 20, cursor: full ? "not-allowed" : "pointer", background: full ? "#fafafa" : "#EBF7FA", textAlign: "left", opacity: full ? 0.55 : 1, position: "relative" }}>
                <div style={{ position: "absolute", top: 14, right: 14, background: full ? "#FEF0EB" : "#E8F8F1", color: full ? CORAL : GREEN, fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 10 }}>
                  {full ? "Complet 🚫" : `${r} place(s) libre`}
                </div>
                <Row gap={14} style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 36 }}>{icon}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 18, color: DARK }}>{displayName}</div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Capacité max : {MAX_CAP} personnes</div>
                  </div>
                </Row>
                <div style={{ height: 10, borderRadius: 5, background: "#e0eef3", overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${p}%`, background: bc, borderRadius: 5 }} />
                </div>
                <Row style={{ justifyContent: "space-between", fontSize: 12, color: "#666" }}>
                  <span>{boatPax(boat)} passager(s) réservé(s)</span>
                  <span style={{ fontWeight: 700, color: bc }}>{r} place(s) restante(s)</span>
                </Row>
              </button>
            );
          })}
        </Grid>

        {/* ── Réservations du jour par bateau ── */}
        {(() => {
          const hasAny = selDate.boats.some(b => b.bookings.length > 0);
          if (!hasAny) return null;
          return (
            <div style={{ marginTop: 24, borderTop: "1px solid #e8eef3", paddingTop: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
                Réservations du jour
              </div>
              {selDate.boats.map(boat => {
                if (boat.bookings.length === 0) return null;
                const icon = boat.name === "Aloes Vera" ? "🛥️" : "🚤";
                const dname = boat.name === "Aloes Vera" ? "Aloès Vera" : boat.name;
                return (
                  <div key={boat.id} style={{ marginBottom: 18 }}>
                    {/* Boat header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 16 }}>{icon}</span>
                      <span style={{ fontWeight: 800, color: TEAL, fontSize: 14 }}>{dname}</span>
                      <span style={{ fontSize: 11, color: "#aaa", marginLeft: 4 }}>{boat.bookings.length} rés. · {boatPax(boat)} pax</span>
                    </div>
                    {/* Bookings */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {boat.bookings.map((bk, idx) => {
                        const srcColor = SOURCES[bk.source]?.color || "#999";
                        const srcLabel = SOURCES[bk.source]?.label || bk.source || "?";
                        const isWoo    = bk.source === "woo";
                        const tel      = fullPhone(bk);
                        const waNum    = tel ? tel.replace(/[^0-9]/g, "") : null;
                        return (
                          <div key={idx} style={{ background: "#F8FBFC", borderRadius: 10, padding: "11px 14px", border: "1px solid #e8eef3" }}>
                            <Row style={{ marginBottom: bk.phone ? 8 : 0, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ background: srcColor, color: "#fff", fontSize: 10, padding: "2px 9px", borderRadius: 7, fontWeight: 700, flexShrink: 0 }}>
                                {isWoo ? "🌐 Web" : srcLabel}
                              </span>
                              <span style={{ fontWeight: 700, color: DARK, fontSize: 13, flex: 1 }}>{bk.name || "—"}</span>
                              <span style={{ fontSize: 12, color: "#666", fontWeight: 600, flexShrink: 0 }}>
                                👥 {bk.children ? `${bk.adults}+${bk.children}` : bk.adults} pax
                              </span>
                            </Row>
                            {bk.phone && (
                              <Row gap={8}>
                                <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer"
                                  style={{ display: "flex", alignItems: "center", gap: 5, background: "#25D366", color: "#fff", borderRadius: 7, padding: "6px 14px", textDecoration: "none", fontSize: 12, fontWeight: 700 }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                  WhatsApp
                                </a>
                                <a href={`tel:${tel}`}
                                  style={{ display: "flex", alignItems: "center", gap: 5, background: TEAL, color: "#fff", borderRadius: 7, padding: "6px 14px", textDecoration: "none", fontSize: 12, fontWeight: 700 }}>
                                  📞 Appeler
                                </a>
                              </Row>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );

  // ── Booking form ───────────────────────────
  if (step === "form" && selDate && selBoat) {
    const icon = selBoat.name === "Aloes Vera" ? "🛥️" : "🚤";
    const displayName = selBoat.name === "Aloes Vera" ? "Aloès Vera" : selBoat.name;
    return (
      <div style={{ flex: 1, padding: "0 20px 40px", maxWidth: 520, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <button onClick={() => setStep("boat")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", borderRadius: 20, padding: "7px 18px", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
          ← Retour
        </button>
        <div style={{ background: "#fff", borderRadius: 20, padding: 24 }}>
          <div style={{ background: "#F0F8FB", borderRadius: 12, padding: "12px 16px", marginBottom: 22, border: `1px solid ${TEAL}20` }}>
            <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontWeight: 800, color: TEAL }}>📅 {selDate.label}</span>
              <span style={{ fontWeight: 700, color: DARK }}>{icon} {displayName}</span>
              <span style={{ fontWeight: 700, color: GREEN, fontSize: 12, background: "#E8F8F1", padding: "3px 10px", borderRadius: 8 }}>{spots(selBoat)} place(s)</span>
            </Row>
          </div>
          <h3 style={{ margin: "0 0 18px", color: DARK }}>Votre réservation</h3>
          <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 18 }}>
            <Counter label="Adultes" sublabel={`${P_AD}€/pers.`} value={form.adults}
              onChange={v => setForm(f => ({ ...f, adults: v, price: v * P_AD + f.children * P_CH }))} />
            <Counter label="Enfants" sublabel={`${P_CH}€/pers.`} value={form.children}
              onChange={v => setForm(f => ({ ...f, children: v, price: f.adults * P_AD + v * P_CH }))} />
          </Grid>
          <div style={{ marginBottom: 14 }}>
            <FSelect label="Référent(e)" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
              <option value="">— Sélectionner —</option>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </FSelect>
          </div>
          <div style={{ marginBottom: 14 }}>
            <PhoneInput prefixKey={form.phone_prefix||"+33"} onPrefixChange={v=>setForm(f=>({...f,phone_prefix:v}))} value={form.phone} onChange={v=>setForm(f=>({...f,phone:v}))} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <FInput label="Nom du client" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom, prénom..." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <FInput label="Email client" type="email" value={form.email||""} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemple.com" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Label>Notes (optionnel)</Label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="🎂 Anniversaire, ♿ handicap, remise, demande spéciale..."
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <Label>Remise commerciale (€)</Label>
            <input type="number" min="0" value={form.discount||0}
              onChange={e => { const d=Math.max(0,+e.target.value); setForm(f=>({...f,discount:d,price:Math.max(0,f.adults*P_AD+f.children*P_CH-d)})); }}
              style={inputStyle} placeholder="0" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <Label>Acompte versé (€)</Label>
            <input type="number" min="0" value={form.acompte_amount||0}
              onChange={e => setForm(f=>({...f,acompte_amount:Math.max(0,+e.target.value)}))}
              style={inputStyle} placeholder="0" />
          </div>
          <div style={{ marginBottom: 22 }}>
            <PriceBreakdown form={form} />
          </div>
          <Btn full onClick={submit} disabled={!form.name.trim() || form.adults + form.children === 0} style={{ padding: 15, fontSize: 16 }}>
            Valider la réservation ✓
          </Btn>
        </div>
      </div>
    );
  }

  // ── Identification gate ───────────────────
  if (step === "mes-resa" && !identity) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 400, width: "100%" }}>
        <button onClick={() => setStep("cal")} style={{ background: "none", border: "none", color: TEAL, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 16 }}>← Retour</button>
        <h2 style={{ margin: "0 0 6px", color: DARK, fontSize: 18 }}>Qui êtes-vous ?</h2>
        <p style={{ color: "#888", fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>Identifiez-vous pour accéder à vos réservations.</p>
        <div style={{ display: "grid", gap: 10 }}>
          {Object.entries(SOURCES).filter(([k]) => k !== "autre").map(([k, v]) => (
            <button key={k} onClick={() => setIdentity(k)}
              style={{ background: "#F8FBFC", border: `2px solid ${v.color}20`, borderRadius: 12, padding: "14px 18px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12, transition: "all 0.15s" }}>
              <div style={{ width: 36, height: 36, borderRadius: 18, background: v.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                {v.label[0]}
              </div>
              <div>
                <div style={{ fontWeight: 700, color: DARK, fontSize: 14 }}>{v.label}</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>Accéder à mes réservations</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Mes réservations ──────────────────────
  if (step === "mes-resa") {
    // Show confirmed bookings from this reseller across all dates
    const pending = data.dates.flatMap(date =>
      date.boats.flatMap(boat =>
        boat.bookings
          .filter(bk => bk.source === identity)
          .map(bk => ({ ...bk, dateId: date.id, boatId: boat.id, dateLabel: date.label, boatName: boat.name }))
      )
    ).sort((a,b) => (dateFromLabel(a.dateLabel)||new Date(0)) - (dateFromLabel(b.dateLabel)||new Date(0)));
    return (
      <div style={{ flex: 1, padding: "0 20px 40px", maxWidth: 560, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <button onClick={() => { setIdentity(null); setStep("cal"); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", borderRadius: 20, padding: "7px 18px", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
          ← Retour au calendrier
        </button>
        <div style={{ background: "#fff", borderRadius: 20, padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ margin: 0, color: DARK, fontSize: 18 }}>📋 Mes réservations</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: SOURCES[identity]?.color, color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 10 }}>{SOURCES[identity]?.label}</span>
              <button onClick={() => { setIdentity(null); setStep("cal"); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 12 }}>✕</button>
            </div>
          </div>
          {pending.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#aaa" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              <p>Aucune demande en attente.</p>
              <Btn onClick={() => setStep("cal")} style={{ marginTop: 12 }}>Faire une réservation</Btn>
            </div>
          ) : pending.map(p => {
            const icon = p.boatName === "Aloes Vera" ? "🛥️" : "🚤";
            const bname = p.boatName === "Aloes Vera" ? "Aloès Vera" : p.boatName || "Bateau";
            const isPendingDel = delPending === p.id;
            return (
              <div key={p.id} style={{ border: "1px solid #e0eef3", borderRadius: 14, padding: 16, marginBottom: 12 }}>
                <Row style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: TEAL, fontSize: 14 }}>📅 {p.dateLabel || "Date inconnue"}</div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{icon} {bname}</div>
                  </div>
                  <span style={{ marginLeft: "auto", background: "#E8F8F1", color: GREEN, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 8, alignSelf: "flex-start" }}>✅ Confirmée</span>
                </Row>
                <div style={{ fontSize: 13, color: "#444", lineHeight: 1.9, marginBottom: 12 }}>
                  <div>👤 <strong>{p.name}</strong></div>
                  <div>👥 {p.children ? `${p.adults} adulte(s) + ${p.children} enfant(s)` : `${p.adults} adulte(s)`}</div>
                  {p.phone && (()=>{const tel=fullPhone(p);const wa=tel.replace(/[^0-9]/g,"");return(<>
                  <div style={{fontSize:13,color:"#555"}}>📞 {p.phone_prefix||""}{p.phone}</div>
                  <Row gap={8} style={{marginTop:5}}>
                    <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" style={{background:"#25D366",color:"#fff",borderRadius:8,padding:"6px 14px",textDecoration:"none",fontSize:12,fontWeight:700}}>WhatsApp</a>
                    <a href={`tel:${tel}`} style={{background:TEAL,color:"#fff",borderRadius:8,padding:"6px 14px",textDecoration:"none",fontSize:12,fontWeight:700}}>Appeler</a>
                  </Row>
                </>);})()}
                  {p.notes && <div>📝 {p.notes}</div>}
                  {p.discount > 0 && <div style={{ color: GREEN, fontSize: 12 }}>Remise : -{fmtEur(p.discount)}</div>}
                  {p.acompte_amount > 0 && <div style={{ color: "#888", fontSize: 12 }}>Acompte : {fmtEur(p.acompte_amount)} · Reste à payer : <strong style={{ color: CORAL }}>{fmtEur(Math.max(0,p.price-(p.acompte_amount||0)))}</strong></div>}
                  <div style={{ color: TEAL, fontWeight: 700 }}>💰 {fmtEur(p.adults * P_AD + p.children * P_CH)}</div>
                </div>
                {isPendingDel ? (
                  <Row gap={8}>
                    <Btn small variant="danger" onClick={() => { save({ ...data, dates: data.dates.map(d => d.id !== p.dateId ? d : { ...d, boats: d.boats.map(b => b.id !== p.boatId ? b : { ...b, bookings: b.bookings.filter(bk => bk.id !== p.id) }) }) }); setDelPending(null); }}>Confirmer l'annulation</Btn>
                    <Btn small variant="ghost" onClick={() => setDelPending(null)}>Annuler</Btn>
                  </Row>
                ) : (
                  <Row gap={8}>
                    <Btn small onClick={() => { setEditingPending(p); setEditForm({ adults: p.adults, children: p.children, name: p.name, source: p.source, phone: p.phone, notes: p.notes || "", price: p.price }); setStep("edit-resa"); }}>✏️ Modifier</Btn>
                    <Btn small variant="danger" onClick={() => setDelPending(p.id)}>✕ Annuler la demande</Btn>
                  </Row>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Edit pending reservation ───────────────
  if (step === "edit-resa" && editingPending) {
    const dateEntry = data.dates.find(d => d.id === editingPending.dateId);
    const boat = dateEntry?.boats.find(b => b.id === editingPending.boatId);
    const icon = boat?.name === "Aloes Vera" ? "🛥️" : "🚤";
    const bname = boat?.name === "Aloes Vera" ? "Aloès Vera" : boat?.name || "Bateau";
    const saveEdit = () => {
      const updated = { ...editingPending, ...editForm, price: editForm.adults * P_AD + editForm.children * P_CH };
      save({ ...data, dates: data.dates.map(d => d.id !== editingPending.dateId ? d : {
        ...d, boats: d.boats.map(b => b.id !== editingPending.boatId ? b : {
          ...b, bookings: b.bookings.map(bk => bk.id !== editingPending.id ? bk : { ...updated, id: bk.id })
        })
      })});
      setEditingPending(null); setStep("mes-resa");
    };
    return (
      <div style={{ flex: 1, padding: "0 20px 40px", maxWidth: 520, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <button onClick={() => setStep("mes-resa")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", borderRadius: 20, padding: "7px 18px", fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
          ← Retour à mes réservations
        </button>
        <div style={{ background: "#fff", borderRadius: 20, padding: 24 }}>
          <div style={{ background: "#F0F8FB", borderRadius: 12, padding: "12px 16px", marginBottom: 22, border: `1px solid ${TEAL}20` }}>
            <Row style={{ flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontWeight: 800, color: TEAL }}>📅 {dateEntry?.label}</span>
              <span style={{ fontWeight: 700, color: DARK }}>{icon} {bname}</span>
            </Row>
          </div>
          <h3 style={{ margin: "0 0 18px", color: DARK }}>✏️ Modifier la réservation</h3>
          <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 18 }}>
            <Counter label="Adultes" sublabel={`${P_AD}€/pers.`} value={editForm.adults}
              onChange={v => setEditForm(f => ({ ...f, adults: v, price: v * P_AD + f.children * P_CH }))} />
            <Counter label="Enfants" sublabel={`${P_CH}€/pers.`} value={editForm.children}
              onChange={v => setEditForm(f => ({ ...f, children: v, price: f.adults * P_AD + v * P_CH }))} />
          </Grid>
          <div style={{ marginBottom: 14 }}>
            <FSelect label="Référent(e)" value={editForm.source} onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}>
              <option value="">— Sélectionner —</option>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </FSelect>
          </div>
          <div style={{ marginBottom: 14 }}>
            <PhoneInput prefixKey={editForm.phone_prefix||"+33"} onPrefixChange={v=>setEditForm(f=>({...f,phone_prefix:v}))} value={editForm.phone} onChange={v=>setEditForm(f=>({...f,phone:v}))} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <FInput label="Nom du client" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom, prénom..." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <FInput label="Email client" type="email" value={editForm.email||""} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemple.com" />
          </div>
          <div style={{ marginBottom: 22 }}>
            <Label>Notes (optionnel)</Label>
            <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="🎂 Anniversaire, ♿ handicap, remise..." 
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical", minHeight: 72, fontFamily: "inherit" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <Label>Remise commerciale (€)</Label>
            <input type="number" min="0" value={editForm.discount||0} onChange={e => { const d=Math.max(0,+e.target.value); setEditForm(f=>({...f,discount:d,price:Math.max(0,f.adults*P_AD+f.children*P_CH-d)})); }} style={inputStyle} placeholder="0" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <Label>Acompte versé (€)</Label>
            <input type="number" min="0" value={editForm.acompte_amount||0} onChange={e => setEditForm(f=>({...f,acompte_amount:Math.max(0,+e.target.value)}))} style={inputStyle} placeholder="0" />
          </div>
          <div style={{ marginBottom: 22 }}><PriceBreakdown form={editForm} /></div>
          <Btn full onClick={saveEdit} disabled={!editForm.name.trim() || editForm.adults + editForm.children === 0} style={{ padding: 15, fontSize: 16 }}>
            Valider la réservation ✓
          </Btn>
        </div>
      </div>
    );
  }

  // ── Week helpers ──────────────────────────
  const weekDaysR = Array.from({length:7},(_,i)=>{ const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return d; });
  const prevWeekR = () => { const d=new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); };
  const nextWeekR = () => { const d=new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); };
  const weekLabelR = () => {
    const end = new Date(weekStart); end.setDate(weekStart.getDate()+6);
    return `${weekStart.toLocaleDateString("fr",{day:"numeric",month:"short"})} – ${end.toLocaleDateString("fr",{day:"numeric",month:"short",year:"numeric"})}`;
  };

  // ── Main calendar ──────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 10px 80px", maxWidth: 700, margin: "0 auto", width: "100%", boxSizing: "border-box", overflowX: "hidden" }}>
      {/* Top bar: mes réservations + view toggle */}
      <Row style={{ justifyContent: "space-between", padding: "12px 4px 0", alignItems: "center" }}>
        <div style={{ display:"flex", background:"rgba(255,255,255,0.15)", borderRadius:10, padding:2 }}>
          {[["month","📅"],["week","📆"]].map(([m,lbl])=>(
            <button key={m} onClick={()=>setViewMode(m)}
              style={{ background:viewMode===m?"rgba(255,255,255,0.25)":"transparent", border:"none", borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:viewMode===m?700:400, color:"#fff" }}>
              {lbl} {m==="month"?"Mois":"Semaine"}
            </button>
          ))}
        </div>
        <button onClick={() => setStep("mes-resa")}
          style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 20, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
          📋 Mes réservations
        </button>
      </Row>

      {/* ── WEEK VIEW ── */}
      {viewMode === "week" && (
        <div style={{ flex:1, paddingTop:12 }}>
          <Row style={{ justifyContent:"space-between", marginBottom:12, alignItems:"center" }}>
            <button onClick={prevWeekR} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", width:36, height:36, borderRadius:18, cursor:"pointer", fontSize:18, fontWeight:700 }}>‹</button>
            <span style={{ fontSize:13, fontWeight:700, color:"#fff" }}>{weekLabelR()}</span>
            <button onClick={nextWeekR} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", width:36, height:36, borderRadius:18, cursor:"pointer", fontSize:18, fontWeight:700 }}>›</button>
          </Row>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {weekDaysR.map(cell => {
              const entry  = entryForDay(cell);
              const isToday = cell.toDateString() === today.toDateString();
              const isPast  = cell < new Date(today.getFullYear(), today.getMonth(), today.getDate());
              const avail   = !isPast && entry.boats.some(b => spots(b) > 0);
              const dayLabel = cell.toLocaleDateString("fr",{weekday:"long",day:"numeric",month:"long"});
              return (
                <button key={cell.toISOString()}
                  onClick={()=>{ if(avail){ setSelDate(entry); setStep("boat"); } }}
                  style={{ background:isToday?"rgba(255,255,255,0.22)":"rgba(255,255,255,0.09)", border:isToday?"2px solid rgba(255,255,255,0.65)":"1.5px solid rgba(255,255,255,0.13)", borderRadius:12, padding:"12px 14px", cursor:avail?"pointer":"default", textAlign:"left", opacity:isPast?0.4:1 }}>
                  <Row style={{ marginBottom:8 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:800, color:"#fff", textTransform:"capitalize" }}>{dayLabel}</div>
                    </div>
                    {avail && <span style={{ background:"rgba(255,255,255,0.2)", color:"#fff", fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:8, flexShrink:0 }}>Réserver →</span>}
                    {!avail && !isPast && <span style={{ color:CORAL, fontSize:11, fontWeight:700 }}>Complet</span>}
                    {isPast && <span style={{ color:"rgba(255,255,255,0.35)", fontSize:11 }}>Passé</span>}
                  </Row>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {entry.boats.map(boat=>{
                      const r=spots(boat); const p=pct(boat);
                      const bc=r<=0?CORAL:p>70?ORANGE:"#27AE60";
                      return(
                        <div key={boat.id} style={{ background:"rgba(255,255,255,0.1)", borderRadius:8, padding:"7px 10px", boxSizing:"border-box", width:"100%", overflow:"hidden" }}>
                          <Row style={{ marginBottom:4 }}>
                            <span style={{ fontSize:14 }}>{boat.name==="Aloes Vera"?"🛥️":"🚤"}</span>
                            <span style={{ fontSize:13, fontWeight:700, color:"#fff", flex:1, marginLeft:6 }}>{boat.name==="Aloes Vera"?"Aloès Vera":"Panamax"}</span>
                            <span style={{ fontSize:12, fontWeight:800, color:isPast?"rgba(255,255,255,0.35)":"#FA9F6A" }}>{r<=0?"Complet 🚫":`Reste ${r} place${r>1?"s":""}`}</span>
                          </Row>
                          <div style={{ height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${p}%`, background:isPast?"rgba(255,255,255,0.2)":bc, borderRadius:2 }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop:14, background:"rgba(255,255,255,0.09)", borderRadius:12, padding:"12px 16px" }}>
            <div style={{ color:"rgba(255,255,255,0.85)", fontSize:13, fontWeight:700, marginBottom:4 }}>ℹ️ Comment réserver</div>
            <div style={{ color:"rgba(255,255,255,0.55)", fontSize:12, lineHeight:1.8 }}>Cliquez sur un jour disponible → choisissez votre bateau → remplissez le formulaire.<br/>Tarifs : {P_AD}€/adulte · {P_CH}€/enfant.</div>
          </div>
        </div>
      )}

      {/* ── MONTH VIEW ── */}
      {viewMode === "month" && (<>
      {/* Month nav */}
      <Row style={{ justifyContent: "space-between", padding: "12px 4px 14px" }}>
        <button onClick={prevMonth} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 40, height: 40, borderRadius: 20, cursor: "pointer", fontSize: 20, fontWeight: 700 }}>‹</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>{MONTHS[month]}</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 2 }}>{year}</div>
        </div>
        <button onClick={nextMonth} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 40, height: 40, borderRadius: 20, cursor: "pointer", fontSize: 20, fontWeight: 700 }}>›</button>
      </Row>

      {/* Legend */}
      <Row style={{ justifyContent: "center", marginBottom: 14, flexWrap: "wrap", gap: 14 }}>
        {[{ c: GREEN, l: "Disponible" }, { c: ORANGE, l: "Presque complet" }, { c: CORAL, l: "Complet" }].map(({ c, l }) => (
          <Row key={l} gap={5} style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
            <div style={{ width: 9, height: 9, borderRadius: 5, background: c, flexShrink: 0 }} />{l}
          </Row>
        ))}
      </Row>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 2, marginBottom: 2 }}>
        {DAYS_SHORT.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", padding: "4px 0" }}>{d}</div>)}
      </div>

      {/* Calendar cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 2 }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={"e" + i} />;

          const entry    = entryForDay(cell);
          const isToday  = cell.toDateString() === today.toDateString();
          const isPast   = cell < new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const avail    = !isPast && entry.boats.some(b => spots(b) > 0);
          const clickable = avail;

          return (
            <button
              key={cell.toISOString()}
              onClick={() => { if (clickable) { setSelDate(entry); setStep("boat"); } }}
              style={{
                background: isPast ? "rgba(255,255,255,0.04)" : isToday ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
                border: isToday ? "2px solid rgba(255,255,255,0.7)" : "1.5px solid rgba(255,255,255,0.1)",
                borderRadius: 11,
                padding: "5px 3px",
                cursor: clickable ? "pointer" : "default",
                minHeight: 70,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                overflow: "hidden",
                opacity: isPast ? 0.35 : 1,
              }}>
              <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 500, color: "#fff" }}>{cell.getDate()}</span>

              {/* Both boats, every day */}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 2, overflow: "hidden", boxSizing: "border-box", padding: "0 2px" }}>
                {entry.boats.map(boat => {
                  const r  = spots(boat);
                  const p  = pct(boat);
                  const bc = barColor(boat);
                  return (
                    <div key={boat.id} style={{ background: "rgba(255,255,255,0.13)", borderRadius: 4, padding: "2px 4px", overflow: "hidden", minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 9, lineHeight: 1, flexShrink: 0 }}>{boat.name === "Aloes Vera" ? "🛥️" : "🚤"}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: r <= 0 ? CORAL : "#FA9F6A", flexShrink: 0, marginLeft: 1 }}>{r <= 0 ? "✕" : `R${r}`}</span>
                      </div>
                      <div style={{ height: 2, borderRadius: 2, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${p}%`, background: bc, borderRadius: 2 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {/* Info */}
      <div style={{ marginTop: 16, background: "rgba(255,255,255,0.1)", borderRadius: 12, padding: "12px 16px", border: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 700, marginBottom: 5 }}>ℹ️ Comment réserver</div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, lineHeight: 1.8 }}>
          Cliquez sur n'importe quel jour → choisissez votre bateau → remplissez le formulaire.<br />
          Tarifs : {P_AD}€/adulte · {P_CH}€/enfant.
        </div>
      </div>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// COMPTABILITÉ TAB
// ════════════════════════════════════════════════════════════════
function ComptaTab({ data, sources: srcMap }) {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0,10);
  const [dateFrom, setDateFrom] = useState(fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo,   setDateTo]   = useState(fmt(today));
  const [view,     setView]     = useState("synthese"); // synthese | detail | skippers

  const S = srcMap || SOURCES;
  const srcLabel = (s) => S[s]?.label || s || "?";
  const srcColor = (s) => S[s]?.color || "#999";

  // Filter all bookings by date range
  const from = new Date(dateFrom + "T00:00:00");
  const to   = new Date(dateTo   + "T23:59:59");

  const allBk = [];
  const workDays = {}; // dateLabel → {aloes: bool, panamax: bool, pax, rev}

  for (const date of data.dates) {
    const d = dateFromLabel(date.label);
    if (!d || d < from || d > to) continue;

    const dayKey = date.label;
    if (!workDays[dayKey]) workDays[dayKey] = { label: dayKey, date: d, aloes: false, panamax: false, pax: 0, rev: 0, bkCount: 0 };

    for (const boat of date.boats) {
      const isAloes = boat.name === "Aloes Vera";
      if (boat.bookings.length > 0) {
        if (isAloes) workDays[dayKey].aloes = true;
        else         workDays[dayKey].panamax = true;
      }
      for (const bk of boat.bookings) {
        workDays[dayKey].pax += bk.adults + bk.children;
        workDays[dayKey].rev += bk.price;
        workDays[dayKey].bkCount++;
        allBk.push({ ...bk, dateLabel: date.label, dateObj: d, boatName: boat.name });
      }
    }
  }

  // Aggregates
  const totalRev      = allBk.reduce((s,b) => s + b.price, 0);
  const totalPax      = allBk.reduce((s,b) => s + b.adults + b.children, 0);
  const totalAdults   = allBk.reduce((s,b) => s + b.adults, 0);
  const totalChildren = allBk.reduce((s,b) => s + b.children, 0);
  const totalDiscount = allBk.reduce((s,b) => s + (b.discount||0), 0);
  const totalAcompte  = allBk.reduce((s,b) => s + (b.acompte_amount||0), 0);
  const totalReste    = allBk.reduce((s,b) => s + Math.max(0, b.price - (b.acompte_amount||0)), 0);
  const baseRev       = totalAdults * P_AD + totalChildren * P_CH;
  const workDaysList  = Object.values(workDays).sort((a,b) => a.date-b.date);
  const daysAloes     = workDaysList.filter(d => d.aloes).length;
  const daysPanamax   = workDaysList.filter(d => d.panamax).length;
  const daysTotal     = workDaysList.filter(d => d.aloes || d.panamax).length;

  // By source
  const bySource = {};
  for (const bk of allBk) {
    const s = bk.source || "autre";
    if (!bySource[s]) bySource[s] = { count:0, pax:0, rev:0, discount:0 };
    bySource[s].count++;
    bySource[s].pax += bk.adults + bk.children;
    bySource[s].rev += bk.price;
    bySource[s].discount += bk.discount||0;
  }

  // By boat
  const byBoat = { "Aloes Vera": {pax:0,rev:0,days:daysAloes}, "Panamax": {pax:0,rev:0,days:daysPanamax} };
  for (const bk of allBk) {
    const bn = bk.boatName === "Aloes Vera" ? "Aloes Vera" : "Panamax";
    byBoat[bn].pax += bk.adults + bk.children;
    byBoat[bn].rev += bk.price;
  }

  // CSV export
  const exportCSV = (rows, headers, filename) => {
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportDetail = () => {
    const headers = ["Date","Bateau","Référent","Nom client","Adultes","Enfants","Tél","Email","Prix brut","Remise","Prix net","Acompte","Reste à payer","Notes"];
    const rows = allBk.map(bk => [
      bk.dateLabel,
      bk.boatName === "Aloes Vera" ? "Aloès Vera" : "Panamax",
      srcLabel(bk.source),
      bk.name,
      bk.adults, bk.children,
      bk.phone ? `${bk.phone_prefix||""}${bk.phone}` : "",
      bk.email||"",
      bk.adults*P_AD+bk.children*P_CH,
      bk.discount||0,
      bk.price,
      bk.acompte_amount||0,
      Math.max(0,bk.price-(bk.acompte_amount||0)),
      (bk.notes||"").replace(/"/g,"'"),
    ]);
    exportCSV(rows, headers, `panamax-detail-${dateFrom}-${dateTo}.csv`);
  };

  const exportSynthese = () => {
    const headers = ["Date","Aloès Vera","Panamax","Réservations","Passagers","CA (€)"];
    const rows = workDaysList.map(d => [d.label, d.aloes?"✓":"", d.panamax?"✓":"", d.bkCount, d.pax, d.rev]);
    exportCSV(rows, headers, `panamax-synthese-${dateFrom}-${dateTo}.csv`);
  };

  const exportSkippers = () => {
    const headers = ["Date","Aloès Vera travaille","Panamax travaille","Passagers","CA (€)"];
    const rows = workDaysList.map(d => [d.label, d.aloes?"OUI":"", d.panamax?"OUI":"", d.pax, d.rev]);
    exportCSV(rows, headers, `panamax-skippers-${dateFrom}-${dateTo}.csv`);
  };

  const Section = ({title, children}) => (
    <div style={{background:"#fff",borderRadius:14,padding:"16px 18px",marginBottom:14,border:"1px solid #deeaf0"}}>
      <div style={{fontWeight:700,color:TEAL,fontSize:14,marginBottom:12}}>{title}</div>
      {children}
    </div>
  );

  const KPI = ({label, value, sub, color=TEAL, icon}) => (
    <div style={{background:"#F8FBFC",borderRadius:10,padding:"12px 14px",border:"1px solid #e0eef3",textAlign:"center"}}>
      <div style={{fontSize:11,color:"#888",marginBottom:4}}>{icon} {label}</div>
      <div style={{fontSize:20,fontWeight:800,color}}>{value}</div>
      {sub && <div style={{fontSize:10,color:"#aaa",marginTop:2}}>{sub}</div>}
    </div>
  );

  return (
    <div>
      {/* Date range picker */}
      <div style={{background:"#fff",borderRadius:14,padding:"16px 18px",marginBottom:14,border:"1px solid #deeaf0"}}>
        <div style={{fontWeight:700,color:TEAL,fontSize:14,marginBottom:12}}>🗓️ Plage de dates</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10, marginBottom:12 }}>
          <FInput label="Du" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          <FInput label="Au" type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)} />
        </div>
        <Row gap={8} style={{flexWrap:"wrap"}}>
          {[
            ["Aujourd'hui", ()=>{setDateFrom(fmt(today));setDateTo(fmt(today));}],
            ["Cette semaine", ()=>{const mon=new Date(today);mon.setDate(today.getDate()-((today.getDay()||7)-1));const sun=new Date(mon);sun.setDate(mon.getDate()+6);setDateFrom(fmt(mon));setDateTo(fmt(sun));}],
            ["Ce mois", ()=>{setDateFrom(fmt(new Date(today.getFullYear(),today.getMonth(),1)));setDateTo(fmt(new Date(today.getFullYear(),today.getMonth()+1,0)));}],
            ["Cette année", ()=>{setDateFrom(`${today.getFullYear()}-01-01`);setDateTo(`${today.getFullYear()}-12-31`);}],
          ].map(([lbl, fn])=>(
            <button key={lbl} onClick={fn} style={{background:"#EBF7FA",border:"none",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:TEAL}}>{lbl}</button>
          ))}
        </Row>
      </div>

      {/* View selector */}
      <div style={{display:"flex",background:"#EBF7FA",borderRadius:10,padding:3,marginBottom:14,width:"fit-content"}}>
        {[["synthese","📊 Synthèse"],["detail","📋 Détail"],["skippers","⚓ Skippers"]].map(([v,lbl])=>(
          <button key={v} onClick={()=>setView(v)}
            style={{background:view===v?"#fff":"transparent",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontSize:12,fontWeight:view===v?700:400,color:view===v?TEAL:"#888",boxShadow:view===v?"0 1px 4px rgba(0,0,0,0.1)":"none"}}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── SYNTHÈSE ── */}
      {view === "synthese" && (<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:14}}>
          <KPI icon="💰" label="CA total" value={fmtEur(totalRev)} sub={`Base : ${fmtEur(baseRev)}`} color={TEAL} />
          <KPI icon="💸" label="Remises accordées" value={`-${fmtEur(totalDiscount)}`} color={CORAL} />
          <KPI icon="✅" label="Acomptes encaissés" value={fmtEur(totalAcompte)} color={GREEN} />
          <KPI icon="⏳" label="Reste à encaisser" value={fmtEur(totalReste)} color={totalReste>0?ORANGE:GREEN} />
          <KPI icon="👥" label="Passagers" value={totalPax} sub={`${totalAdults} ad. · ${totalChildren} enf.`} />
          <KPI icon="📋" label="Réservations" value={allBk.length} sub={`${daysTotal} jour(s) de sortie`} />
        </div>

        <Section title="💰 CA par référent(e)">
          {Object.entries(bySource).sort((a,b)=>b[1].rev-a[1].rev).map(([src,stats])=>(
            <Row key={src} style={{padding:"8px 0",borderBottom:"1px solid #f5f8fa",gap:10}}>
              <span style={{background:srcColor(src),color:"#fff",fontSize:11,padding:"2px 10px",borderRadius:8,fontWeight:700,minWidth:40,textAlign:"center"}}>{srcLabel(src)}</span>
              <span style={{flex:1,fontSize:13,color:"#555"}}>{stats.count} rés. · {stats.pax} pax</span>
              {stats.discount>0&&<span style={{fontSize:11,color:GREEN}}>-{fmtEur(stats.discount)}</span>}
              <span style={{fontWeight:800,color:TEAL,fontSize:14}}>{fmtEur(stats.rev)}</span>
            </Row>
          ))}
          {Object.keys(bySource).length===0&&<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:12}}>Aucune donnée</div>}
        </Section>

        <Section title="🚤 CA par bateau">
          {Object.entries(byBoat).map(([name,stats])=>(
            <Row key={name} style={{padding:"8px 0",borderBottom:"1px solid #f5f8fa",gap:10}}>
              <span style={{fontSize:16}}>{name==="Aloes Vera"?"🛥️":"🚤"}</span>
              <span style={{flex:1,fontWeight:700,color:DARK}}>{name==="Aloes Vera"?"Aloès Vera":name}</span>
              <span style={{fontSize:12,color:"#888"}}>{stats.days} j. · {stats.pax} pax</span>
              <span style={{fontWeight:800,color:TEAL,fontSize:14}}>{fmtEur(stats.rev)}</span>
            </Row>
          ))}
        </Section>

        <Row gap={8} style={{flexWrap:"wrap"}}>
          <Btn variant="success" onClick={exportSynthese} disabled={allBk.length===0}>⬇️ Export synthèse CSV</Btn>
          <Btn variant="ghost" onClick={exportDetail} disabled={allBk.length===0}>⬇️ Export détail CSV</Btn>
        </Row>
      </>)}

      {/* ── DÉTAIL ── */}
      {view === "detail" && (<>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #deeaf0",overflow:"hidden",marginBottom:14}}>
          <Row style={{padding:"12px 16px",borderBottom:"1px solid #f0f5f7",justifyContent:"space-between"}}>
            <span style={{fontWeight:700,color:TEAL,fontSize:14}}>📋 {allBk.length} réservation(s)</span>
            <Btn small variant="success" onClick={exportDetail} disabled={allBk.length===0}>⬇️ CSV</Btn>
          </Row>
          {allBk.length===0&&<div style={{padding:"30px",textAlign:"center",color:"#bbb",fontSize:13}}>Aucune réservation sur cette période.</div>}
          {allBk.map((bk,idx)=>(
            <div key={bk.id||idx} style={{padding:"12px 16px",borderBottom:idx<allBk.length-1?"1px solid #f5f8fa":"none"}}>
              <Row style={{marginBottom:6,flexWrap:"wrap",gap:8}}>
                <span style={{fontWeight:700,color:TEAL,fontSize:13}}>📅 {bk.dateLabel}</span>
                <span style={{fontSize:12,color:"#888"}}>{bk.boatName==="Aloes Vera"?"🛥️ Aloès Vera":"🚤 Panamax"}</span>
                <span style={{background:srcColor(bk.source),color:"#fff",fontSize:10,padding:"2px 8px",borderRadius:7,fontWeight:700}}>{srcLabel(bk.source)}</span>
              </Row>
              <Row style={{flexWrap:"wrap",gap:12,fontSize:13,marginBottom:4}}>
                <span style={{fontWeight:600,color:DARK}}>{bk.name}</span>
                <span style={{color:"#888"}}>👥 {bk.adults}ad{bk.children?`+${bk.children}enf`:""}</span>
                {bk.email&&<span style={{color:"#aaa",fontSize:11}}>✉️ {bk.email}</span>}
              </Row>
              <Row style={{justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div style={{fontSize:11,color:"#888"}}>
                  Base : {fmtEur(bk.adults*P_AD+bk.children*P_CH)}
                  {bk.discount>0&&<span style={{color:GREEN}}> · Remise -{fmtEur(bk.discount)}</span>}
                </div>
                <Row gap={12}>
                  {bk.acompte_amount>0&&<span style={{fontSize:12,color:"#888"}}>Acompte {fmtEur(bk.acompte_amount)}</span>}
                  {bk.acompte_amount>0&&<span style={{fontSize:12,fontWeight:700,color:Math.max(0,bk.price-(bk.acompte_amount||0))===0?GREEN:ORANGE}}>
                    {Math.max(0,bk.price-(bk.acompte_amount||0))===0?"✅ Soldé":`Reste ${fmtEur(Math.max(0,bk.price-(bk.acompte_amount||0)))}`}
                  </span>}
                  <span style={{fontWeight:800,fontSize:15,color:TEAL}}>{fmtEur(bk.price)}</span>
                </Row>
              </Row>
              {bk.notes&&<div style={{fontSize:11,color:"#aaa",fontStyle:"italic",marginTop:3}}>📝 {bk.notes}</div>}
            </div>
          ))}
        </div>
      </>)}

      {/* ── SKIPPERS ── */}
      {view === "skippers" && (<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8,marginBottom:14}}>
          <KPI icon="📅" label="Jours de sortie" value={daysTotal} color={TEAL} />
          <KPI icon="🛥️" label="Jours Aloès Vera" value={daysAloes} color="#2471A3" />
          <KPI icon="🚤" label="Jours Panamax" value={daysPanamax} color="#1A5F7A" />
        </div>

        <Section title="⚓ Calendrier des sorties">
          {workDaysList.length===0&&<div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:12}}>Aucune sortie sur cette période.</div>}
          {workDaysList.map((d,i)=>(
            <Row key={i} style={{padding:"10px 0",borderBottom:"1px solid #f5f8fa",gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:DARK,fontSize:13}}>{d.label}</div>
                <div style={{fontSize:11,color:"#888",marginTop:2}}>{d.bkCount} rés. · {d.pax} passager(s)</div>
              </div>
              <Row gap={6}>
                {d.aloes  &&<span style={{background:"#EBF7FA",color:TEAL,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:8}}>🛥️ Aloès Vera</span>}
                {d.panamax&&<span style={{background:"#EBF7FA",color:TEAL,fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:8}}>🚤 Panamax</span>}
              </Row>
              <span style={{fontWeight:700,color:TEAL,fontSize:13,flexShrink:0}}>{fmtEur(d.rev)}</span>
            </Row>
          ))}
        </Section>

        <Btn variant="success" onClick={exportSkippers} disabled={workDaysList.length===0}>⬇️ Export skippers CSV</Btn>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// REVENDEURS TAB COMPONENT
// ════════════════════════════════════════════════════════════════
const PALETTE = ["#1A5F7A","#2471A3","#C0392B","#1E8449","#7D3C98","#8E44AD","#E67E22","#16A085","#2C3E50","#27AE60","#D35400","#7F8C8D"];

function RevendeursTab({ sources, saveSources }) {
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ label: "", color: PALETTE[0] });
  const [adding,  setAdding]  = useState(false);
  const [newForm, setNewForm] = useState({ label: "", color: PALETTE[0] });
  const [delKey,  setDelKey]  = useState(null);
  const [notif,   setNotif]   = useState(null);

  const toast = (msg, ok=true) => { setNotif({msg,ok}); setTimeout(()=>setNotif(null),3000); };
  const FIXED = ["woo","autre"];

  const startEdit = (key) => { setEditing(key); setForm({ label: sources[key].label, color: sources[key].color }); };

  const saveEdit = () => {
    if (!form.label.trim()) return;
    saveSources({ ...sources, [editing]: { label: form.label.trim(), color: form.color } });
    setEditing(null); toast("Référent(e) modifié(e) ✓");
  };

  const saveAdd = () => {
    if (!newForm.label.trim()) return;
    const key = newForm.label.trim().toLowerCase().replace(/[^a-z0-9]/g,"_") + "_" + uid();
    saveSources({ ...sources, [key]: { label: newForm.label.trim(), color: newForm.color } });
    setAdding(false); setNewForm({ label:"", color:PALETTE[0] }); toast("Référent(e) ajouté(e) ✓");
  };

  const doDelete = (key) => {
    const next = { ...sources }; delete next[key];
    saveSources(next); setDelKey(null); toast("Référent(e) supprimé(e)");
  };

  const ColorPicker = ({ value, onChange }) => (
    <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:6 }}>
      {PALETTE.map(c => (
        <button key={c} onClick={()=>onChange(c)}
          style={{ width:30, height:30, borderRadius:15, background:c, border: value===c ? "3px solid #fff" : "3px solid transparent", outline: value===c ? `2px solid ${c}` : "none", cursor:"pointer" }} />
      ))}
    </div>
  );

  const editableSources = Object.entries(sources).filter(([k])=>!FIXED.includes(k));
  const fixedSources    = Object.entries(sources).filter(([k])=> FIXED.includes(k));
  const previewLabel    = (lbl, color) => (
    <span style={{ background:color, color:"#fff", padding:"2px 12px", borderRadius:10, fontWeight:700, fontSize:12 }}>{lbl||"Aperçu"}</span>
  );

  return (
    <div>
      <div style={{ background:"#fff", borderRadius:14, padding:"18px 20px", border:"1px solid #deeaf0", marginBottom:12 }}>
        <Row style={{ marginBottom:18 }}>
          <h2 style={{ margin:0, color:TEAL, fontSize:18 }}>👥 Gestion des Référent(e)s</h2>
          <div style={{ marginLeft:"auto" }}>
            <Btn onClick={()=>{ setAdding(true); setEditing(null); }}>+ Ajouter</Btn>
          </div>
        </Row>

        {/* Add form */}
        {adding && (
          <div style={{ background:"#F0F8FB", borderRadius:12, padding:16, marginBottom:16, border:`1px solid ${TEAL}30` }}>
            <div style={{ fontWeight:700, color:TEAL, marginBottom:14 }}>+ Nouveau(elle) référent(e)</div>
            <div style={{ marginBottom:12 }}>
              <Label>Nom</Label>
              <input value={newForm.label} onChange={e=>setNewForm(f=>({...f,label:e.target.value}))}
                placeholder="ex: Marie, Agence ABC..."
                style={{ width:"100%", padding:"9px 12px", border:"1px solid #ddd", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <Label>Couleur du badge</Label>
              <ColorPicker value={newForm.color} onChange={c=>setNewForm(f=>({...f,color:c}))} />
            </div>
            <Row gap={8}>
              <Btn onClick={saveAdd} disabled={!newForm.label.trim()}>Enregistrer</Btn>
              <Btn variant="ghost" onClick={()=>{ setAdding(false); setNewForm({label:"",color:PALETTE[0]}); }}>Annuler</Btn>
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#666" }}>
                Aperçu : {previewLabel(newForm.label, newForm.color)}
              </div>
            </Row>
          </div>
        )}

        {/* Editable sources */}
        <div style={{ marginBottom:8 }}>
          {editableSources.length === 0 && !adding && (
            <div style={{ textAlign:"center", padding:"20px", color:"#bbb", fontSize:13 }}>Aucun référent. Cliquez sur "+ Ajouter".</div>
          )}
          {editableSources.map(([key, src]) => {
            const isEd  = editing === key;
            const isDel = delKey === key;
            return (
              <div key={key} style={{ borderRadius:10, marginBottom:8, border:`1px solid ${isEd ? TEAL : "#e8eef3"}`, overflow:"hidden" }}>
                {isEd ? (
                  <div style={{ padding:14, background:"#F0F8FB" }}>
                    <div style={{ marginBottom:12 }}>
                      <Label>Nom</Label>
                      <input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))}
                        style={{ width:"100%", padding:"9px 12px", border:"1px solid #ddd", borderRadius:8, fontSize:14, boxSizing:"border-box" }} />
                    </div>
                    <div style={{ marginBottom:14 }}>
                      <Label>Couleur du badge</Label>
                      <ColorPicker value={form.color} onChange={c=>setForm(f=>({...f,color:c}))} />
                    </div>
                    <Row gap={8}>
                      <Btn small onClick={saveEdit} disabled={!form.label.trim()}>Enregistrer</Btn>
                      <Btn small variant="ghost" onClick={()=>setEditing(null)}>Annuler</Btn>
                      <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8, fontSize:12, color:"#666" }}>
                        Aperçu : {previewLabel(form.label, form.color)}
                      </div>
                    </Row>
                  </div>
                ) : (
                  <Row style={{ padding:"12px 14px", background:"#fff" }}>
                    <span style={{ background:src.color, color:"#fff", fontSize:12, padding:"3px 14px", borderRadius:10, fontWeight:700, minWidth:50, textAlign:"center", flexShrink:0 }}>{src.label}</span>
                    <div style={{ flex:1, paddingLeft:8, fontSize:12, color:"#aaa" }}>Identifiant : {key}</div>
                    <Row gap={6}>
                      <button onClick={()=>startEdit(key)}
                        style={{ background:"#EBF7FA", border:"none", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:12, color:TEAL, fontWeight:600 }}>✏️ Modifier</button>
                      {isDel ? (
                        <Row gap={4}>
                          <Btn small variant="danger" onClick={()=>doDelete(key)}>Confirmer</Btn>
                          <Btn small variant="ghost"  onClick={()=>setDelKey(null)}>✕</Btn>
                        </Row>
                      ) : (
                        <button onClick={()=>setDelKey(key)}
                          style={{ background:"#FEF0EB", border:"none", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:12, color:CORAL, fontWeight:600 }}>🗑</button>
                      )}
                    </Row>
                  </Row>
                )}
              </div>
            );
          })}
        </div>

        {/* Fixed entries */}
        <div style={{ borderTop:"1px solid #f0f5f7", paddingTop:12 }}>
          <div style={{ fontSize:11, color:"#bbb", marginBottom:8, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Entrées système (non modifiables)</div>
          <Row gap={8} style={{ flexWrap:"wrap" }}>
            {fixedSources.map(([key,src])=>(
              <span key={key} style={{ background:src.color, color:"#fff", fontSize:11, padding:"3px 12px", borderRadius:10, fontWeight:700 }}>{src.label}</span>
            ))}
          </Row>
        </div>
      </div>

      {notif && <div style={{ position:"fixed", bottom:22, left:"50%", transform:"translateX(-50%)", background:notif.ok?TEAL:CORAL, color:"#fff", padding:"10px 24px", borderRadius:28, fontSize:14, fontWeight:600, zIndex:9999 }}>{notif.msg}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// STATS TAB COMPONENT
// ════════════════════════════════════════════════════════════════
function StatsTab({ data, sources: srcMap }) {
  const today      = new Date();
  const [period,   setPeriod]   = useState("month");  // jour | semaine | mois | année | tout
  const [source,   setSource]   = useState("all");    // all | luc | lud | cdi | cam | ici | woo | autre
  const [refDate,  setRefDate]  = useState(today);    // reference date for period navigation

  // ── Period navigation ─────────────────────────────────────
  const periodLabel = () => {
    if (period === "tout") return "Toutes les périodes";
    if (period === "jour")    return refDate.toLocaleDateString("fr", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
    if (period === "semaine") {
      const mon = new Date(refDate); mon.setDate(refDate.getDate() - (refDate.getDay()||7) + 1);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return `${mon.toLocaleDateString("fr",{day:"numeric",month:"short"})} – ${sun.toLocaleDateString("fr",{day:"numeric",month:"short",year:"numeric"})}`;
    }
    if (period === "mois") return refDate.toLocaleDateString("fr", { month:"long", year:"numeric" });
    if (period === "année") return refDate.getFullYear().toString();
    return "";
  };

  const shift = (dir) => {
    const d = new Date(refDate);
    if (period === "jour")    d.setDate(d.getDate() + dir);
    if (period === "semaine") d.setDate(d.getDate() + dir * 7);
    if (period === "mois")    d.setMonth(d.getMonth() + dir);
    if (period === "année")   d.setFullYear(d.getFullYear() + dir);
    setRefDate(d);
  };

  const inPeriod = (label) => {
    if (period === "tout") return true;
    const d = dateFromLabel(label);
    if (!d) return false;
    if (period === "jour") return d.toDateString() === refDate.toDateString();
    if (period === "semaine") {
      const mon = new Date(refDate); mon.setDate(refDate.getDate() - (refDate.getDay()||7) + 1); mon.setHours(0,0,0,0);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
      return d >= mon && d <= sun;
    }
    if (period === "mois") return d.getMonth() === refDate.getMonth() && d.getFullYear() === refDate.getFullYear();
    if (period === "année") return d.getFullYear() === refDate.getFullYear();
    return false;
  };

  // ── Filter bookings ───────────────────────────────────────
  const filtered = [];
  for (const date of data.dates) {
    if (!inPeriod(date.label)) continue;
    for (const boat of date.boats) {
      for (const bk of boat.bookings) {
        if (source !== "all" && bk.source !== source) continue;
        filtered.push({ ...bk, dateLabel: date.label, boatName: boat.name === "Aloes Vera" ? "Aloès Vera" : boat.name });
      }
    }
  }
  filtered.sort((a, b) => {
    const da = dateFromLabel(a.dateLabel) || new Date(0);
    const db = dateFromLabel(b.dateLabel) || new Date(0);
    return da - db;
  });

  // ── Aggregates ────────────────────────────────────────────
  const totalPax  = filtered.reduce((s, bk) => s + bk.adults + bk.children, 0);
  const totalRev  = filtered.reduce((s, bk) => s + bk.price, 0);
  const totalBk   = filtered.length;
  const acompteOui = filtered.filter(bk => bk.acompte === "oui").length;
  const acompteNon = filtered.filter(bk => bk.acompte === "non").length;

  // Stats by source
  const bySource = {};
  for (const bk of filtered) {
    const src = bk.source || "autre";
    if (!bySource[src]) bySource[src] = { count: 0, pax: 0, rev: 0 };
    bySource[src].count++;
    bySource[src].pax += bk.adults + bk.children;
    bySource[src].rev += bk.price;
  }

  // ── CSV Export ────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ["Date","Bateau","Référent","Nom client","Adultes","Enfants","Téléphone","Email","Prix","Acompte","Notes"];
    const rows = filtered.map(bk => [
      bk.dateLabel,
      bk.boatName,
      SOURCES[bk.source]?.label || bk.source || "?",
      bk.name,
      bk.adults,
      bk.children,
      bk.phone ? `${bk.phone_prefix||""}${bk.phone}` : "",
      bk.email || "",
      bk.price + "€",
      bk.acompte_amount > 0 ? fmtEur(bk.acompte_amount) : "",
      (bk.notes || "").replace(/,/g, ";"),
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `panamax-${period}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const S = srcMap || SOURCES;
  const srcColor  = (src) => S[src]?.color || "#999";
  const srcLabel  = (src) => S[src]?.label || src || "?";

  return (
    <div>
      {/* ── Filters ── */}
      <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", marginBottom: 14, border: "1px solid #deeaf0" }}>

        {/* Period filter */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Période</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {[["jour","Jour"],["semaine","Semaine"],["mois","Mois"],["année","Année"],["tout","Tout"]].map(([v,l]) => (
              <button key={v} onClick={() => setPeriod(v)}
                style={{ padding: "6px 14px", borderRadius: 20, border: "none", background: period === v ? TEAL : "#EBF7FA", color: period === v ? "#fff" : TEAL, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                {l}
              </button>
            ))}
          </div>
          {period !== "tout" && (
            <Row style={{ justifyContent: "space-between", background: "#F0F8FB", borderRadius: 10, padding: "8px 14px" }}>
              <button onClick={() => shift(-1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: TEAL, fontWeight: 700 }}>‹</button>
              <span style={{ fontWeight: 700, color: DARK, fontSize: 14 }}>{periodLabel()}</span>
              <button onClick={() => shift(1)}  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: TEAL, fontWeight: 700 }}>›</button>
            </Row>
          )}
        </div>

        {/* Source filter */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Référent(e)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setSource("all")}
              style={{ padding: "6px 14px", borderRadius: 20, border: "none", background: source === "all" ? DARK : "#EBF7FA", color: source === "all" ? "#fff" : DARK, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Tous
            </button>
            {Object.entries(SOURCES).map(([k, v]) => (
              <button key={k} onClick={() => setSource(k)}
                style={{ padding: "6px 14px", borderRadius: 20, border: "none", background: source === k ? v.color : "#EBF7FA", color: source === k ? "#fff" : "#555", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 14 }}>
        {[
          { v: totalBk,          l: "Réservations",    i: "📋", c: TEAL  },
          { v: totalPax,         l: "Passagers",        i: "👥", c: TEAL  },
          { v: fmtEur(totalRev), l: "Chiffre d'aff.",   i: "💰", c: CORAL },
          { v: `${acompteOui}/${totalBk}`, l: "Acomptes encaissés", i: "✅", c: GREEN },
        ].map(({ v, l, i, c }) => (
          <div key={l} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #e0eef3", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{i} {l}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* ── By source breakdown ── */}
      {source === "all" && Object.keys(bySource).length > 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: 14, border: "1px solid #deeaf0" }}>
          <div style={{ fontWeight: 700, color: TEAL, marginBottom: 12, fontSize: 14 }}>📊 Par référent(e)</div>
          {Object.entries(bySource).sort((a,b) => b[1].rev - a[1].rev).map(([src, stats]) => (
            <Row key={src} style={{ padding: "8px 0", borderBottom: "1px solid #f5f8fa", gap: 10 }}>
              <span style={{ background: srcColor(src), color: "#fff", fontSize: 11, padding: "2px 10px", borderRadius: 8, fontWeight: 700, minWidth: 40, textAlign: "center" }}>{srcLabel(src)}</span>
              <span style={{ flex: 1, fontSize: 13, color: "#555" }}>{stats.count} rés. · {stats.pax} pax</span>
              <span style={{ fontWeight: 800, color: TEAL, fontSize: 14 }}>{fmtEur(stats.rev)}</span>
            </Row>
          ))}
        </div>
      )}

      {/* ── Bookings list ── */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #deeaf0", overflow: "hidden", marginBottom: 14 }}>
        <Row style={{ padding: "12px 18px", borderBottom: "1px solid #f0f5f7", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, color: TEAL, fontSize: 14 }}>📋 Réservations ({filtered.length})</span>
          <button onClick={exportCSV} disabled={filtered.length === 0}
            style={{ background: filtered.length === 0 ? "#eee" : GREEN, color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", cursor: filtered.length === 0 ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
            ⬇️ Télécharger CSV
          </button>
        </Row>

        {filtered.length === 0 && (
          <div style={{ padding: "30px", textAlign: "center", color: "#bbb", fontSize: 13 }}>Aucune réservation pour cette sélection.</div>
        )}

        {filtered.map((bk, idx) => (
          <div key={bk.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, padding: "12px 18px", borderBottom: idx < filtered.length-1 ? "1px solid #f5f8fa" : "none", alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", minWidth: 52 }}>
              <span style={{ background: srcColor(bk.source), color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 8, fontWeight: 700, whiteSpace: "nowrap" }}>{srcLabel(bk.source)}</span>
              <span style={{ fontSize: 10, color: "#aaa", textAlign: "center" }}>{bk.boatName === "Aloès Vera" ? "🛥️" : "🚤"}</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: DARK, fontSize: 13, marginBottom: 2 }}>{bk.name}</div>
              <div style={{ fontSize: 11, color: "#888" }}>
                📅 {bk.dateLabel} · 👥 {bk.children ? `${bk.adults}+${bk.children}` : bk.adults} pax
                
                {bk.email && ` · ✉️ ${bk.email}`}
              </div>
              {bk.notes && <div style={{ fontSize: 11, color: "#999", fontStyle: "italic", marginTop: 2 }}>📝 {bk.notes}</div>}
              {bk.acompte && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: bk.acompte === "oui" ? "#E8F8F1" : "#FEF0EB", color: bk.acompte === "oui" ? GREEN : CORAL, marginTop: 3, display: "inline-block" }}>
                  {bk.acompte === "oui" ? "✅ Acompte OK" : "❌ Acompte manquant"}
                </span>
              )}
            </div>
            <span style={{ fontWeight: 800, color: bk.price === 0 ? ORANGE : TEAL, fontSize: 14, whiteSpace: "nowrap" }}>
              {bk.price === 0 ? "Offert" : fmtEur(bk.price)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// WOOCOMMERCE SYNC COMPONENT
// ════════════════════════════════════════════════════════════════
function WooTab({ data, save, notify }) {
  const [siteUrl,    setSiteUrl]    = useState("https://panamaxexcursions.com");
  const [ck,         setCk]         = useState("");
  const [cs,         setCs]         = useState("");
  const [loading,    setLoading]    = useState(false);
  const [orders,     setOrders]     = useState(null);
  const [preview,    setPreview]    = useState(null);
  const [error,      setError]      = useState(null);
  const [mode,       setMode]       = useState("api"); // "api" | "json"
  const [jsonText,   setJsonText]   = useState("");

  // Parse WooCommerce date "2026-05-17" → label "Samedi 17/05"
  const wooDateToLabel = (str) => {
    if (!str) return null;
    const d = new Date(str + "T00:00:00");
    if (isNaN(d)) return null;
    return labelFromDate(d);
  };

  // Get meta value from order meta_data array
  const meta = (order, key) => {
    const m = (order.meta_data || []).find(m => m.key === key);
    return m ? m.value : null;
  };

  // Find best available boat for a date entry
  const bestBoat = (dateEntry) => {
    if (!dateEntry) return null;
    // pick boat with most remaining spots
    return dateEntry.boats.reduce((best, b) => {
      return (!best || spots(b) > spots(best)) ? b : best;
    }, null);
  };

  // Map WooCommerce orders to Panamax bookings
  const mapOrders = (raw) => {
    const mapped = [];
    for (const order of raw) {
      if (order.status !== "completed" && order.status !== "processing") continue;

      const adults   = parseInt(meta(order, "adult_number") || meta(order, "Nombre Adultes") || meta(order, "nombre_adultes") || "1", 10);
      const children = parseInt(meta(order, "child_number") || meta(order, "Enfant de -12 ans") || meta(order, "enfant_de_-12_ans") || "0", 10);
      const date1str = meta(order, "date_1") || meta(order, "Date privilégiée") || meta(order, "date_privilegiee");
      const date2str = meta(order, "date_2") || meta(order, "Seconde date possible") || meta(order, "seconde_date");
      const infoComp = meta(order, "additional_informations") || meta(order, "Informations complémentaires") || meta(order, "informations_complementaires") || order.customer_note || "";
      const label1   = wooDateToLabel(date1str);
      const label2   = wooDateToLabel(date2str);
      const name     = `${order.billing?.first_name || ""} ${order.billing?.last_name || ""}`.trim() || "Client web";
      const phone    = order.billing?.phone || "";
      const email    = order.billing?.email || "";

      // Check if already imported (by order id in notes)
      const alreadyIn = data.dates.some(d => d.boats.some(b => b.bookings.some(bk => bk.wooOrderId === order.id)));
      if (alreadyIn) { mapped.push({ order, status: "already", label: label1 }); continue; }

      // Find date entry for preferred date, fallback to second date
      let chosenLabel = null;
      let dateEntry   = null;
      let boat        = null;

      for (const label of [label1, label2].filter(Boolean)) {
        // Find existing entry or create virtual
        const existing = data.dates.find(d => d.label === label);
        const entry = existing || { id: null, label, _virtual: true, boats: [
          { id: "v-aloes-" + label, name: "Aloes Vera", emoji: "ferry", bookings: [] },
          { id: "v-panamax-" + label, name: "Panamax",  emoji: "boat",  bookings: [] },
        ]};
        const b = bestBoat(entry);
        if (b && spots(b) > 0) { chosenLabel = label; dateEntry = entry; boat = b; break; }
      }

      if (!chosenLabel) {
        mapped.push({ order, status: "full", label: label1, label2, name, adults });
        continue;
      }

      mapped.push({
        order, status: "ready", name, phone, email, adults, children, infoComp,
        label: chosenLabel,
        usedFallback: chosenLabel === label2,
        dateEntry, boat,
        booking: { id: uid(), adults, children, name, phone, source: "woo", price: children > 0 ? adults * P_AD + children * P_CH : adults * P_AD, notes: [`#${order.id}`, email, infoComp].filter(Boolean).join(" · "), status: "confirmed", wooOrderId: order.id, ts: Date.now() }
      });
    }
    return mapped;
  };

  const fetchOrders = async () => {
    setLoading(true); setError(null); setOrders(null); setPreview(null);
    try {
      // Appel via le proxy Vercel — pas de CORS, clés sécurisées côté serveur
      const res = await fetch('/api/woo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Erreur ${res.status}`);
      }
      const raw = await res.json();
      setOrders(raw);
      setPreview(mapOrders(raw));
    } catch (e) {
      setError(e.message || "Erreur de connexion au proxy WooCommerce.");
    }
    setLoading(false);
  };

  const importReady = () => {
    if (!preview) return;
    let nextData = { ...data };
    let count = 0;
    for (const item of preview) {
      if (item.status !== "ready") continue;
      const { booking, dateEntry, boat } = item;

      // Find or create the date entry
      let existingDate = nextData.dates.find(d => d.label === dateEntry.label);
      if (!existingDate) {
        existingDate = { id: uid(), label: dateEntry.label, boats: [
          { id: uid(), name: "Aloes Vera", emoji: "ferry", bookings: [] },
          { id: uid(), name: "Panamax",    emoji: "boat",  bookings: [] },
        ]};
        nextData = { ...nextData, dates: [...nextData.dates, existingDate] };
      }

      // Find matching boat by name
      const targetBoatName = boat.name;
      nextData = { ...nextData, dates: nextData.dates.map(d => d.label !== existingDate.label ? d : {
        ...d, boats: d.boats.map(b => b.name !== targetBoatName ? b : {
          ...b, bookings: [...b.bookings, booking]
        })
      })};
      count++;
    }
    save(nextData);
    notify(`${count} commande(s) WooCommerce importée(s) ✓`);
    setPreview(mapOrders(orders)); // refresh preview
  };

  const readyCount = preview ? preview.filter(p => p.status === "ready").length : 0;

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #deeaf0" }}>
      <h2 style={{ margin: "0 0 6px", color: TEAL, fontSize: 20 }}>🛒 Synchronisation WooCommerce</h2>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 22, lineHeight: 1.6 }}>
        Importez automatiquement les commandes du site. Les clients sont affectés au bateau avec le plus de disponibilité sur leur date préférentielle.
      </p>

      {/* Mode switcher */}
      <div style={{ display: "flex", background: "#F0F4F8", borderRadius: 10, padding: 3, marginBottom: 20, width: "fit-content" }}>
        {[["api", "🔑 Via API"], ["json", "📋 Coller le JSON"]].map(([m, lbl]) => (
          <button key={m} onClick={() => { setMode(m); setError(null); setPreview(null); }}
            style={{ background: mode === m ? "#fff" : "transparent", border: "none", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 13, fontWeight: mode === m ? 700 : 400, color: mode === m ? TEAL : "#888", boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.1)" : "none" }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* API mode */}
      {mode === "api" && (
        <div style={{ background: "#F0F8FB", borderRadius: 12, padding: 18, marginBottom: 20, border: `1px solid ${TEAL}20` }}>
          <Row gap={10}>
            <div style={{ fontSize: 28 }}>✅</div>
            <div>
              <div style={{ fontWeight: 700, color: TEAL, fontSize: 14, marginBottom: 4 }}>Connexion configurée</div>
              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.7 }}>
                Les clés WooCommerce sont sécurisées sur Vercel.<br/>
                Cliquez sur "Récupérer les commandes" pour synchroniser.
              </div>
            </div>
          </Row>
        </div>
      )}

      {/* JSON paste mode */}
      {mode === "json" && (
        <div style={{ background: "#F8FBFC", borderRadius: 12, padding: 18, marginBottom: 20, border: "1px solid #e0eef3" }}>
          <div style={{ fontWeight: 700, color: DARK, fontSize: 13, marginBottom: 6 }}>📋 Coller le JSON des commandes</div>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 14, lineHeight: 1.7 }}>
            Dans votre navigateur, ouvrez cette URL (remplacez les clés) :<br/>
            <code style={{ background: "#E8F4FD", padding: "3px 8px", borderRadius: 5, fontSize: 11, wordBreak: "break-all", display: "block", marginTop: 6 }}>
              {siteUrl}/wp-json/wc/v3/orders?consumer_key=ck_XXX&consumer_secret=cs_XXX&per_page=50&status=completed,processing
            </code>
          </p>
          <FInput label="URL du site (pour construire le lien)" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://panamaxexcursions.com" />
          <div style={{ marginTop: 12 }}>
            <Label>Collez ici le JSON copié depuis le navigateur</Label>
            <textarea value={jsonText} onChange={e => setJsonText(e.target.value)}
              placeholder='[{"id": 2892, "status": "completed", "billing": {...}, "meta_data": [...]}]'
              style={{ width: "100%", height: 120, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 12, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical", background: "#fff", marginTop: 4 }} />
          </div>
        </div>
      )}

      <Row gap={10} style={{ marginBottom: 24 }}>
        {mode === "api"  && <Btn onClick={fetchOrders} disabled={loading}>{loading ? "Chargement…" : "🔄 Récupérer les commandes"}</Btn>}
        {mode === "json" && <Btn onClick={() => { try { const raw = JSON.parse(jsonText); setOrders(raw); setPreview(mapOrders(raw)); setError(null); } catch { setError("JSON invalide — vérifiez le contenu collé."); } }} disabled={!jsonText.trim()}>🔍 Analyser le JSON</Btn>}
        {readyCount > 0 && <Btn variant="success" onClick={importReady}>✓ Importer {readyCount} commande(s)</Btn>}
      </Row>

      {error && (
        <div style={{ background: "#FEF0EB", border: `1px solid ${CORAL}40`, borderRadius: 10, padding: "12px 16px", marginBottom: 20, color: CORAL, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div>
          <div style={{ fontWeight: 700, color: TEAL, marginBottom: 12, fontSize: 15 }}>
            Aperçu — {preview.length} commande(s) · {readyCount} à importer
          </div>
          {preview.map((item, i) => {
            const icon = item.status === "ready" ? (item.usedFallback ? "🟡" : "🟢") : item.status === "already" ? "✅" : "🔴";
            const bname = item.boat?.name === "Aloes Vera" ? "Aloès Vera" : item.boat?.name;
            return (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderBottom: "1px solid #f0f5f7", fontSize: 13 }}>
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                <div style={{ flex: 1 }}>
                  <Row style={{ flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                    <strong style={{ color: DARK }}>{item.name || `Commande #${item.order.id}`}</strong>
                    <span style={{ color: "#aaa" }}>#{item.order.id}</span>
                    {item.adults && <Chip bg="#EBF7FA" color={TEAL}>{item.adults} adulte(s){item.children > 0 ? ` + ${item.children} enfant(s)` : ""}</Chip>}
                  </Row>
                  <div style={{ color: "#666", lineHeight: 1.8 }}>
                    {item.status === "ready" && <>
                      <span>📅 {item.label}</span>
                      {item.usedFallback && <span style={{ color: ORANGE, fontSize: 11, marginLeft: 6 }}>(date de repli)</span>}
                      <span style={{ margin: "0 8px", color: "#ddd" }}>·</span>
                      <span>{item.boat?.name === "Aloes Vera" ? "🛥️ Aloès Vera" : "🚤 Panamax"}</span>
                      <span style={{ margin: "0 8px", color: "#ddd" }}>·</span>
                      <span style={{ color: GREEN, fontWeight: 700 }}>{spots(item.boat)} place(s) libre(s)</span>
                      {item.infoComp && <><span style={{ margin: "0 8px", color: "#ddd" }}>·</span><span style={{ color: "#888", fontStyle: "italic" }}>"{item.infoComp}"</span></>}
                    </>}
                    {item.status === "already" && <span style={{ color: GREEN }}>✅ Déjà importée — {item.label}</span>}
                    {item.status === "full"    && <span style={{ color: CORAL }}>🚫 Aucune disponibilité sur {item.label}{item.label2 ? ` ni ${item.label2}` : ""}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ADMIN CALENDAR COMPONENT
// ════════════════════════════════════════════════════════════════
function AdminCalendar({ data, save, notify, editing, setEditing, adding, setAdding, delBk, setDelBk, saveEdit, saveAdd, doDelBk, copied, copyWA }) {
  const today = new Date();
  const [year,     setYear]     = useState(today.getFullYear());
  const [month,    setMonth]    = useState(today.getMonth());
  const [selDay,   setSelDay]   = useState(null); // selected date entry
  const [delDate,  setDelDate]  = useState(null);
  const [adminStep, setAdminStep] = useState("day"); // "day" | "add-form" | "edit-form"
  const [addBoat,   setAddBoat]   = useState(null);  // boat selected for add
  const [viewMode,  setViewMode]  = useState("week"); // "month" | "week"
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d; // Start from today
  });

  const prevMonth = () => { if (month === 0) { setYear(y => y-1); setMonth(11); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y+1); setMonth(0); } else setMonth(m => m+1); };

  // Build date lookup
  const byDay = {};
  for (const entry of data.dates) {
    const d = dateFromLabel(entry.label);
    if (!d) continue;
    byDay[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`] = entry;
  }

  // Calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;
  const cells = Array(startDow).fill(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));



  const doDelDate = (id) => {
    save({ ...data, dates: data.dates.filter(d => d.id !== id) });
    setDelDate(null); setSelDay(null); notify("Date supprimée");
  };

  // ── Add reservation full page ──────────────
  if (adminStep === "add-form" && adding && addBoat) {
    const entry = data.dates.find(d => d.id === adding.dateId);
    const boatIcon = addBoat.name === "Aloes Vera" ? "🛥️" : "🚤";
    const boatName = addBoat.name === "Aloes Vera" ? "Aloès Vera" : addBoat.name;
    return (
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #deeaf0" }}>
        <button onClick={() => { setAdminStep("day"); setAdding(null); setAddBoat(null); }}
          style={{ background: "#EBF7FA", border: "none", borderRadius: 8, padding: "7px 16px", cursor: "pointer", color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 20, display: "flex", alignItems: "center", gap: 6 }}>
          ← Retour
        </button>
        <div style={{ background: "#F0F8FB", borderRadius: 12, padding: "12px 16px", marginBottom: 22, border: `1px solid ${TEAL}20` }}>
          <Row style={{ flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontWeight: 800, color: TEAL }}>📅 {entry?.label}</span>
            <span style={{ color: "#ccc" }}>·</span>
            <span style={{ fontWeight: 700, color: DARK }}>{boatIcon} {boatName}</span>
            <span style={{ marginLeft: "auto", fontWeight: 700, color: GREEN, fontSize: 12, background: "#E8F8F1", padding: "3px 10px", borderRadius: 8 }}>{spots(addBoat)} place(s)</span>
          </Row>
        </div>
        <h3 style={{ margin: "0 0 20px", color: DARK }}>+ Nouvelle réservation</h3>
        <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 18 }}>
          <Counter label="Adultes" sublabel={`${P_AD}€/pers.`} value={adding.form.adults}
            onChange={v => setAdding(a => ({ ...a, form: { ...a.form, adults: v, price: v*P_AD+a.form.children*P_CH } }))} />
          <Counter label="Enfants" sublabel={`${P_CH}€/pers.`} value={adding.form.children}
            onChange={v => setAdding(a => ({ ...a, form: { ...a.form, children: v, price: a.form.adults*P_AD+v*P_CH } }))} />
        </Grid>
        <div style={{ marginBottom: 14 }}>
          <FSelect label="Référent(e)" value={adding.form.source} onChange={e => setAdding(a => ({ ...a, form: { ...a.form, source: e.target.value } }))}>
            {Object.entries(SOURCES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </FSelect>
        </div>
        <div style={{ marginBottom: 14 }}>
          <PhoneInput prefixKey={adding.form.phone_prefix||"+33"} onPrefixChange={v=>setAdding(a=>({...a,form:{...a.form,phone_prefix:v}}))} value={adding.form.phone} onChange={v=>setAdding(a=>({...a,form:{...a.form,phone:v}}))} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <FInput label="Nom du client" value={adding.form.name} onChange={e => setAdding(a => ({ ...a, form: { ...a.form, name: e.target.value } }))} placeholder="Nom, prénom..." />
        </div>
        <div style={{ marginBottom: 14 }}>
          <FInput label="Email client" type="email" value={adding.form.email||""} onChange={e => setAdding(a => ({ ...a, form: { ...a.form, email: e.target.value } }))} placeholder="email@exemple.com" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Notes (optionnel)</Label>
          <textarea value={adding.form.notes} onChange={e => setAdding(a => ({ ...a, form: { ...a.form, notes: e.target.value } }))}
            placeholder="🎂 Anniversaire, ♿ handicap, remise..."
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical", minHeight: 72, fontFamily: "inherit" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Remise commerciale (€)</Label>
          <input type="number" min="0" value={adding.form.discount||0}
            onChange={e => { const d=Math.max(0,+e.target.value); setAdding(a=>({...a,form:{...a.form,discount:d,price:Math.max(0,a.form.adults*P_AD+a.form.children*P_CH-d)}})); }}
            style={inputStyle} placeholder="0" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Acompte versé (€)</Label>
          <input type="number" min="0" value={adding.form.acompte_amount||0}
            onChange={e => setAdding(a=>({...a,form:{...a.form,acompte_amount:Math.max(0,+e.target.value)}}))}
            style={inputStyle} placeholder="0" />
        </div>
        <div style={{ marginBottom: 22 }}><PriceBreakdown form={adding.form} /></div>
        <button onClick={() => {
            const entry = data.dates.find(d => d.id === adding.dateId);
            sendConfirmationEmail(adding.form, entry?.label || "");
            sendTelegramNotif(`🆕 Nouvelle réservation (Admin)\n📅 ${entry?.label || ""}\n👤 ${adding.form.name}\n👥 ${adding.form.adults} adulte(s)${adding.form.children ? ` + ${adding.form.children} enfant(s)` : ""}\n💰 ${adding.form.price}€\n👥 Via : ${SOURCES[adding.form.source]?.label || adding.form.source || "?"}`);
            saveAdd(); setAdminStep("day"); setAddBoat(null);
          }}
          disabled={!adding.form.name.trim() || adding.form.adults+adding.form.children === 0}
          style={{ width: "100%", background: TEAL, color: "#fff", border: "none", borderRadius: 12, padding: 15, cursor: "pointer", fontWeight: 800, fontSize: 15, opacity: (!adding.form.name.trim()||adding.form.adults+adding.form.children===0) ? 0.4 : 1 }}>
          Valider la réservation ✓
        </button>
      </div>
    );
  }

  // ── Edit reservation full page ───────────────
  if (adminStep === "edit-form" && editing) {
    const entry = data.dates.find(d => d.id === editing.dateId);
    const boat  = entry?.boats.find(b => b.id === editing.boatId);
    const boatIcon = boat?.name === "Aloes Vera" ? "🛥️" : "🚤";
    const boatName = boat?.name === "Aloes Vera" ? "Aloès Vera" : boat?.name;
    return (
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, border: "1px solid #deeaf0" }}>
        <button onClick={() => { setAdminStep("day"); setEditing(null); }}
          style={{ background: "#EBF7FA", border: "none", borderRadius: 8, padding: "7px 16px", cursor: "pointer", color: TEAL, fontWeight: 700, fontSize: 13, marginBottom: 20, display: "flex", alignItems: "center", gap: 6 }}>
          ← Retour
        </button>
        <div style={{ background: "#F0F8FB", borderRadius: 12, padding: "12px 16px", marginBottom: 22, border: `1px solid ${TEAL}20` }}>
          <Row style={{ flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontWeight: 800, color: TEAL }}>📅 {entry?.label}</span>
            <span style={{ color: "#ccc" }}>·</span>
            <span style={{ fontWeight: 700, color: DARK }}>{boatIcon} {boatName}</span>
          </Row>
        </div>
        <h3 style={{ margin: "0 0 20px", color: DARK }}>✏️ Modifier la réservation</h3>
        <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 18 }}>
          <Counter label="Adultes" sublabel={`${P_AD}€/pers.`} value={editing.form.adults}
            onChange={v => setEditing(ed => ({ ...ed, form: { ...ed.form, adults: v, price: v*P_AD+ed.form.children*P_CH } }))} />
          <Counter label="Enfants" sublabel={`${P_CH}€/pers.`} value={editing.form.children}
            onChange={v => setEditing(ed => ({ ...ed, form: { ...ed.form, children: v, price: ed.form.adults*P_AD+v*P_CH } }))} />
        </Grid>
        <div style={{ marginBottom: 14 }}>
          <FSelect label="Référent(e)" value={editing.form.source} onChange={e => setEditing(ed => ({ ...ed, form: { ...ed.form, source: e.target.value } }))}>
            {Object.entries(SOURCES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </FSelect>
        </div>
        <div style={{ marginBottom: 14 }}>
          <PhoneInput prefixKey={editing.form.phone_prefix||"+33"} onPrefixChange={v=>setEditing(ed=>({...ed,form:{...ed.form,phone_prefix:v}}))} value={editing.form.phone} onChange={v=>setEditing(ed=>({...ed,form:{...ed.form,phone:v}}))} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <FInput label="Nom du client" value={editing.form.name} onChange={e => setEditing(ed => ({ ...ed, form: { ...ed.form, name: e.target.value } }))} placeholder="Nom, prénom..." />
        </div>
        <div style={{ marginBottom: 14 }}>
          <FInput label="Email client" type="email" value={editing.form.email||""} onChange={e => setEditing(ed => ({ ...ed, form: { ...ed.form, email: e.target.value } }))} placeholder="email@exemple.com" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Notes (optionnel)</Label>
          <textarea value={editing.form.notes||""} onChange={e => setEditing(ed => ({ ...ed, form: { ...ed.form, notes: e.target.value } }))}
            placeholder="🎂 Anniversaire, ♿ handicap, remise..."
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical", minHeight: 72, fontFamily: "inherit" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Remise commerciale (€)</Label>
          <input type="number" min="0" value={editing.form.discount||0}
            onChange={e => { const d=Math.max(0,+e.target.value); setEditing(ed=>({...ed,form:{...ed.form,discount:d,price:Math.max(0,ed.form.adults*P_AD+ed.form.children*P_CH-d)}})); }}
            style={inputStyle} placeholder="0" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Acompte versé (€)</Label>
          <input type="number" min="0" value={editing.form.acompte_amount||0}
            onChange={e => setEditing(ed=>({...ed,form:{...ed.form,acompte_amount:Math.max(0,+e.target.value)}}))}
            style={inputStyle} placeholder="0" />
        </div>
        <div style={{ marginBottom: 22 }}><PriceBreakdown form={editing.form} /></div>
        <button onClick={() => { saveEdit(); setAdminStep("day"); }}
          disabled={!editing.form.name.trim() || editing.form.adults+editing.form.children === 0}
          style={{ width: "100%", background: TEAL, color: "#fff", border: "none", borderRadius: 12, padding: 15, cursor: "pointer", fontWeight: 800, fontSize: 15, opacity: (!editing.form.name.trim()||editing.form.adults+editing.form.children===0) ? 0.4 : 1 }}>
          Valider la réservation ✓
        </button>
      </div>
    );
  }

  // Selected day detail view
  if (selDay) {
    const entry = data.dates.find(d => d.id === selDay) || null;
    if (!entry) { setSelDay(null); return null; }
    const allBookings = entry.boats.flatMap(boat => boat.bookings.map(bk => ({ ...bk, boat })));
    const dp = entry.boats.reduce((s, b) => s + boatPax(b), 0);
    const dr = entry.boats.reduce((s, b) => s + boatRev(b), 0);

    return (
      <div>
        {/* Day detail header */}
        <div style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", marginBottom: 12, border: "1px solid #deeaf0" }}>
          <Row style={{ marginBottom: 12 }}>
            <button onClick={() => { setSelDay(null); setEditing(null); setAdding(null); setDelBk(null); setAdminStep("day"); setAddBoat(null); }}
              style={{ background: "#EBF7FA", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", color: TEAL, fontWeight: 700, fontSize: 13 }}>
              ← Calendrier
            </button>
            <span style={{ fontSize: 17, fontWeight: 800, color: TEAL, flex: 1, textAlign: "center" }}>📅 {entry.label}</span>
            <button onClick={e => { e.stopPropagation(); copyWA(entry); }}
              style={{ background: copied === entry.id ? GREEN : "#fff", color: copied === entry.id ? "#fff" : "#555", border: "1px solid #ddd", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {copied === entry.id ? "✓ Copié !" : "📋 WhatsApp"}
            </button>
            {delDate === entry.id
              ? <Row gap={6}><Btn small variant="danger" onClick={() => doDelDate(entry.id)}>Supprimer</Btn><Btn small variant="ghost" onClick={() => setDelDate(null)}>✕</Btn></Row>
              : <button onClick={() => setDelDate(entry.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", fontSize: 18 }}>🗑</button>
            }
          </Row>
          <Row gap={16}>
            <Chip bg="#EBF7FA" color={TEAL}>👥 {dp} passager(s)</Chip>
            <Chip bg="#FEF0EB" color={CORAL}>💰 {fmtEur(dr)}</Chip>
          </Row>
        </div>

        {/* Boats capacity */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 12 }}>
          {entry.boats.map(boat => {
            const icon = boat.name === "Aloes Vera" ? "🛥️" : "🚤";
            const displayName = boat.name === "Aloes Vera" ? "Aloès Vera" : boat.name;
            const isAdding = adding?.dateId === entry.id && adding?.boatId === boat.id;
            return (
              <div key={boat.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #deeaf0" }}>
                <Row style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>{icon}</span>
                  <span style={{ fontWeight: 700, color: DARK, flex: 1, fontSize: 14 }}>{displayName}</span>
                  <span style={{ fontWeight: 700, color: TEAL, fontSize: 13 }}>{fmtEur(boatRev(boat))}</span>
                </Row>
                <CapBar boat={boat} />
                <button onClick={() => { setAddBoat(boat); setAdding({ dateId: entry.id, boatId: boat.id, form: { ...BLANK } }); setAdminStep("add-form"); }}
                  style={{ marginTop: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderRadius: 8, background: TEAL, border: "none", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  + Ajouter une réservation
                </button>
              </div>
            );
          })}
        </div>

        {/* All bookings */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #deeaf0", overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #f0f5f7", fontWeight: 700, color: TEAL, fontSize: 14 }}>
            📋 Réservations du jour ({allBookings.length})
          </div>

          {allBookings.length === 0 && (
            <div style={{ padding: "30px", textAlign: "center", color: "#bbb", fontSize: 13 }}>Aucune réservation pour cette date.</div>
          )}

          {allBookings.map((bk, idx) => {
            const isEd = editing?.boatId === bk.boat.id && editing?.bkId === bk.id;
            const boatIcon = bk.boat.name === "Aloes Vera" ? "🛥️" : "🚤";
            const boatName = bk.boat.name === "Aloes Vera" ? "Aloès Vera" : bk.boat.name;
            const srcColor = SOURCES[bk.source]?.color || "#999";
            const srcLabel = SOURCES[bk.source]?.label || "?";
            const isWoo    = bk.source === "woo";



            const tel    = bk.phone ? fullPhone(bk) : null;
            const waNum  = tel ? tel.replace(/[^0-9]/g,"") : null;
            const reste  = Math.max(0, bk.price-(bk.acompte_amount||0)-(bk.solde_encaisse||0));

            return (
              <div key={bk.id} style={{ borderBottom: idx < allBookings.length-1 ? "1px solid #f0f5f7" : "none", padding: "16px 18px" }}>

                {/* Header : badge source + bateau + nom */}
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                  <span style={{ background:srcColor, color:"#fff", fontSize:11, padding:"3px 10px", borderRadius:10, fontWeight:700, flexShrink:0 }}>
                    {isWoo ? "🌐 Web" : srcLabel}
                  </span>
                  <span style={{ fontSize:12, color:"#aaa", flexShrink:0 }}>{boatIcon} {boatName}</span>
                  <span style={{ fontWeight:800, color:DARK, fontSize:15, flex:1 }}>{bk.name}</span>
                </div>

                {/* Infos ligne par ligne */}
                <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:12 }}>
                  <div style={{ fontSize:13, color:"#555" }}>
                    👥 {bk.children ? `${bk.adults} adulte(s) + ${bk.children} enfant(s)` : `${bk.adults} adulte(s)`}
                  </div>
                  {bk.email && <div style={{ fontSize:13, color:"#888" }}>✉️ {bk.email}</div>}
                  {bk.notes && (
                    <div style={{ fontSize:12, color:"#777", fontStyle:"italic", background:"#F8FBFC", borderRadius:6, padding:"6px 10px", border:"1px solid #eee" }}>
                      📝 {bk.notes}
                    </div>
                  )}

                  {/* Prix */}
                  <div style={{ background:"#F0F8FB", borderRadius:8, padding:"10px 12px", display:"flex", flexDirection:"column", gap:4 }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:12, color:"#888" }}>Total</span>
                      <span style={{ fontWeight:800, fontSize:15, color:bk.price===0?ORANGE:TEAL }}>{bk.price===0?"Offert":fmtEur(bk.price)}</span>
                    </div>
                    {bk.discount > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <span style={{ fontSize:12, color:GREEN }}>Remise</span>
                        <span style={{ fontSize:12, fontWeight:700, color:GREEN }}>-{fmtEur(bk.discount)}</span>
                      </div>
                    )}
                    {bk.acompte_amount > 0 && (
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        <span style={{ fontSize:12, color:"#888" }}>Acompte versé</span>
                        <span style={{ fontSize:12, color:"#888" }}>{fmtEur(bk.acompte_amount)}</span>
                      </div>
                    )}
                    {(bk.acompte_amount > 0 || bk.solde_encaisse > 0) && (
                      <div style={{ display:"flex", justifyContent:"space-between", borderTop:"1px solid #deeaf0", paddingTop:4, marginTop:2 }}>
                        <span style={{ fontSize:12, fontWeight:700, color:reste===0?GREEN:CORAL }}>Reste à payer</span>
                        <span style={{ fontSize:13, fontWeight:800, color:reste===0?GREEN:CORAL }}>{reste===0?"✅ Soldé":fmtEur(reste)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Boutons contact */}
                {tel && (
                  <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
                    <a href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer"
                      style={{ display:"flex", alignItems:"center", gap:5, background:"#25D366", color:"#fff", borderRadius:8, padding:"8px 16px", textDecoration:"none", fontSize:12, fontWeight:700 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      WhatsApp
                    </a>
                    <a href={`tel:${tel}`}
                      style={{ display:"flex", alignItems:"center", gap:5, background:TEAL, color:"#fff", borderRadius:8, padding:"8px 16px", textDecoration:"none", fontSize:12, fontWeight:700 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                      Appeler
                    </a>
                    {reste > 0 && <StripeButton bk={bk} dateLabel={entry.label} dateId={entry.id} boatId={bk.boat.id} small />}
                  </div>
                )}
                {!tel && reste > 0 && (
                  <div style={{ marginBottom:10 }}>
                    <StripeButton bk={bk} dateLabel={entry.label} dateId={entry.id} boatId={bk.boat.id} small />
                  </div>
                )}

                {/* Actions modifier / supprimer */}
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => { setEditing({ dateId:entry.id, boatId:bk.boat.id, bkId:bk.id, form:{...bk} }); setAdminStep("edit-form"); }}
                    style={{ background:"#EBF7FA", border:"none", borderRadius:7, padding:"7px 14px", cursor:"pointer", fontSize:12, color:TEAL, fontWeight:600 }}>✏️ Modifier</button>
                  <button onClick={() => setDelBk(bk.id)}
                    style={{ background:"#FEF0EB", border:"none", borderRadius:7, padding:"7px 14px", cursor:"pointer", fontSize:12, color:CORAL, fontWeight:600 }}>🗑 Supprimer</button>
                </div>

                {delBk === bk.id && (
                  <div style={{ marginTop:10, background:"#FEF8F6", borderRadius:8, padding:"10px 14px" }}>
                    <div style={{ fontSize:12, color:CORAL, marginBottom:8 }}>Confirmer la suppression de cette réservation ?</div>
                    <Row gap={8}>
                      <Btn small variant="danger" onClick={() => doDelBk(entry.id, bk.boat.id, bk.id)}>Oui, supprimer</Btn>
                      <Btn small variant="ghost" onClick={() => setDelBk(null)}>Annuler</Btn>
                    </Row>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Week view helpers ───────────────────────────────────────
  const weekDays = Array.from({length:7},(_,i)=>{ const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return d; });
  const prevWeek = () => { const d=new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); };
  const nextWeek = () => { const d=new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); };
  const weekLabel = () => {
    const end = new Date(weekStart); end.setDate(weekStart.getDate()+6);
    return `${weekStart.toLocaleDateString("fr",{day:"numeric",month:"short"})} – ${end.toLocaleDateString("fr",{day:"numeric",month:"short",year:"numeric"})}`;
  };

  // ── Calendar view ──────────────────────────────────────────
  return (
    <div>
      {/* View toggle */}
      <div style={{ display:"flex", background:"#EBF7FA", borderRadius:10, padding:3, marginBottom:14, maxWidth:"100%", overflowX:"auto" }}>
        {[["month","📅 Mois"],["week","📆 Semaine"]].map(([m,lbl])=>(
          <button key={m} onClick={()=>setViewMode(m)}
            style={{ background:viewMode===m?"#fff":"transparent", border:"none", borderRadius:8, padding:"7px 18px", cursor:"pointer", fontSize:13, fontWeight:viewMode===m?700:400, color:viewMode===m?TEAL:"#888", boxShadow:viewMode===m?"0 1px 4px rgba(0,0,0,0.1)":"none" }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── WEEK VIEW ── */}
      {viewMode === "week" && (
        <div>
          {/* Week nav */}
          <Row style={{ justifyContent:"space-between", marginBottom:14, alignItems:"center" }}>
            <button onClick={prevWeek} style={{ background:"#EBF7FA", border:"none", color:TEAL, width:36, height:36, borderRadius:18, cursor:"pointer", fontSize:18, fontWeight:700 }}>‹</button>
            <span style={{ fontSize:14, fontWeight:700, color:TEAL }}>{weekLabel()}</span>
            <button onClick={nextWeek} style={{ background:"#EBF7FA", border:"none", color:TEAL, width:36, height:36, borderRadius:18, cursor:"pointer", fontSize:18, fontWeight:700 }}>›</button>
          </Row>

          {/* Day cards */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {weekDays.map(cell => {
              const key   = `${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`;
              const entry = byDay[key];
              const isToday = cell.toDateString() === today.toDateString();
              const dp    = entry ? entry.boats.reduce((s,b)=>s+boatPax(b),0) : 0;
              const dr    = entry ? entry.boats.reduce((s,b)=>s+boatRev(b),0) : 0;
              const allBk = entry ? entry.boats.flatMap(boat=>boat.bookings.map(bk=>({...bk,boat}))) : [];
              const dayLabel = cell.toLocaleDateString("fr",{weekday:"long",day:"numeric",month:"long"});

              return (
                <div key={key} style={{ background:"#fff", borderRadius:12, overflow:"hidden", border:`1.5px solid ${isToday?TEAL:"#e0eef3"}`, boxShadow:isToday?`0 0 0 2px ${TEAL}20`:"none" }}>

                  {/* Day header */}
                  <div style={{ background:isToday?TEAL:"#F0F8FB", padding:"10px 14px", display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}
                    onClick={()=>{ if(entry){ setAdminStep("day"); setSelDay(entry.id); } else {
                      const lbl=labelFromDate(cell); const newEntry={id:uid(),label:lbl,boats:[{id:uid(),name:"Aloes Vera",emoji:"ferry",bookings:[]},{id:uid(),name:"Panamax",emoji:"boat",bookings:[]}]};
                      const next={...data,dates:[...data.dates,newEntry]}; save(next); setAdminStep("day"); setSelDay(newEntry.id);
                    }}}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:800, color:isToday?"#fff":DARK, textTransform:"capitalize" }}>{dayLabel}</div>
                      {entry && <div style={{ fontSize:11, color:isToday?"rgba(255,255,255,0.7)":"#aaa", marginTop:1 }}>{dp} passager(s) · {fmtEur(dr)}</div>}
                      {!entry && <div style={{ fontSize:11, color:isToday?"rgba(255,255,255,0.5)":"#ccc", marginTop:1 }}>Aucune réservation — cliquer pour ajouter</div>}
                    </div>
                    {entry && (
                      <Row gap={6}>
                        {entry.boats.map(boat=>{
                          const r=spots(boat); const p=pct(boat);
                          return(
                            <div key={boat.id} style={{ textAlign:"center", minWidth:42 }}>
                              <div style={{ fontSize:11 }}>{boat.name==="Aloes Vera"?"🛥️":"🚤"}</div>
                              <div style={{ fontSize:10, fontWeight:700, color:isToday?"#fff":r<=0?CORAL:"#FA9F6A" }}>R{r}</div>
                              <div style={{ height:3, width:40, borderRadius:2, background:"rgba(255,255,255,0.3)", overflow:"hidden", marginTop:2 }}>
                                <div style={{ height:"100%", width:`${p}%`, background:isToday?"#fff":barColor(boat), borderRadius:2 }}/>
                              </div>
                            </div>
                          );
                        })}
                        <span style={{ fontSize:12, color:isToday?"rgba(255,255,255,0.6)":"#bbb" }}>→</span>
                      </Row>
                    )}
                  </div>

                  {/* Bookings by source */}
                  {entry && allBk.length > 0 && (
                    <div style={{ padding:"10px 14px", display:"flex", flexDirection:"column", gap:6 }}>
                      {/* Group by source */}
                      {Object.entries(
                        allBk.reduce((acc,bk)=>{
                          const src=bk.source||"autre";
                          if(!acc[src]) acc[src]=[];
                          acc[src].push(bk); return acc;
                        },{})
                      ).map(([src, bks])=>{
                        const srcColor = SOURCES[src]?.color||"#999";
                        const srcLabel = SOURCES[src]?.label||src;
                        const totalPax = bks.reduce((s,b)=>s+b.adults+b.children,0);
                        const totalRev = bks.reduce((s,b)=>s+b.price,0);
                        return(
                          <div key={src} style={{ background:`${srcColor}08`, borderRadius:8, marginBottom:6, overflow:"hidden", border:`1px solid ${srcColor}25` }}>
                            {/* Source header */}
                            <div style={{ background:`${srcColor}18`, padding:"6px 10px", display:"flex", alignItems:"center", gap:6 }}>
                              <span style={{ background:srcColor, color:"#fff", fontSize:10, padding:"2px 8px", borderRadius:6, fontWeight:700 }}>{srcLabel}</span>
                              <span style={{ fontSize:10, color:"#666" }}>{bks.length} rés. · {totalPax} pax</span>
                              <span style={{ marginLeft:"auto", fontWeight:800, color:srcColor, fontSize:12 }}>{fmtEur(totalRev)}</span>
                            </div>
                            {/* Booking rows — compact, une info par ligne */}
                            {bks.map((bk,i)=>{
                              const tel   = bk.phone ? fullPhone(bk) : null;
                              const wa    = tel ? tel.replace(/[^0-9]/g,"") : null;
                              const reste = Math.max(0, bk.price-(bk.acompte_amount||0)-(bk.solde_encaisse||0));
                              return(
                                <div key={bk.id} style={{ padding:"10px 12px", borderTop:i>0?`1px solid ${srcColor}15`:"none" }}>
                                  <div style={{ fontWeight:700, color:DARK, fontSize:13, marginBottom:5 }}>
                                    {bk.boat.name==="Aloes Vera"?"🛥️":"🚤"} {bk.name}
                                  </div>
                                  <div style={{ fontSize:12, color:"#555", marginBottom:3 }}>
                                    👥 {bk.children?`${bk.adults}+${bk.children} pax`:`${bk.adults} pax`}
                                  </div>
                                  <div style={{ fontSize:12, fontWeight:700, color:bk.price===0?ORANGE:TEAL, marginBottom:3 }}>
                                    💰 {bk.price===0?"Offert":fmtEur(bk.price)}
                                    {reste>0 && <span style={{ color:CORAL, fontWeight:700 }}> · Reste {fmtEur(reste)}</span>}
                                    {reste===0 && bk.acompte_amount>0 && <span style={{ color:GREEN }}> · ✅ Soldé</span>}
                                  </div>
                                  {bk.notes && <div style={{ fontSize:11, color:"#888", fontStyle:"italic", marginBottom:4 }}>📝 {bk.notes}</div>}
                                  {tel && (
                                    <div style={{ display:"flex", gap:5, marginTop:6, flexWrap:"wrap" }}>
                                      <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" style={{ background:"#25D366", color:"#fff", borderRadius:6, padding:"5px 10px", textDecoration:"none", fontSize:11, fontWeight:700 }}>WhatsApp</a>
                                      <a href={`tel:${tel}`} style={{ background:TEAL, color:"#fff", borderRadius:6, padding:"5px 10px", textDecoration:"none", fontSize:11, fontWeight:700 }}>Appeler</a>
                                      {reste>0 && <StripeButton bk={bk} dateLabel={entry.label} dateId={entry.id} boatId={bk.boat.id} small />}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── MONTH VIEW ── */}
      {viewMode === "month" && (<>
      {/* Month nav */}
      <Row style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <button onClick={prevMonth} style={{ background: "#EBF7FA", border: "none", color: TEAL, width: 38, height: 38, borderRadius: 19, cursor: "pointer", fontSize: 20, fontWeight: 700 }}>‹</button>
        <span style={{ fontSize: 20, fontWeight: 800, color: TEAL }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} style={{ background: "#EBF7FA", border: "none", color: TEAL, width: 38, height: 38, borderRadius: 19, cursor: "pointer", fontSize: 20, fontWeight: 700 }}>›</button>
      </Row>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 2, marginBottom: 2 }}>
        {DAYS_SHORT.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "#888", padding: "3px 0" }}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 2, marginBottom: 14 }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={"e"+i} />;
          const key   = `${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`;
          const entry = byDay[key];
          const isToday = cell.toDateString() === today.toDateString();
          const dp    = entry ? entry.boats.reduce((s, b) => s + boatPax(b), 0) : 0;

          return (
            <button key={cell.toISOString()}
              onClick={() => {
                setAdminStep("day"); setEditing(null); setAdding(null); setAddBoat(null);
                const e = entry || null;
                if (e) { setSelDay(e.id); } else {
                  // Auto-create the date entry
                  const lbl = labelFromDate(cell);
                  const newEntry = { id: uid(), label: lbl, boats: [
                    { id: uid(), name: "Aloes Vera", emoji: "ferry", bookings: [] },
                    { id: uid(), name: "Panamax",    emoji: "boat",  bookings: [] },
                  ]};
                  const next = { ...data, dates: [...data.dates, newEntry] };
                  save(next);
                  setSelDay(newEntry.id);
                }
              }}
              style={{
                background: isToday ? TEAL : entry ? "#EBF7FA" : "#F8FBFC",
                border: isToday ? `2px solid ${TEAL}` : entry ? `1.5px solid ${TEAL}40` : "1.5px solid #e8eef3",
                borderRadius: 10, padding: "8px 4px", cursor: "pointer",
                minHeight: 70, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                transition: "all 0.15s",
              }}>
              <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 500, color: isToday ? "#fff" : entry ? DARK : "#aaa" }}>
                {cell.getDate()}
              </span>
              {entry && (
                <div style={{ width: "100%" }}>
                  {entry.boats.map(boat => {
                    const r  = spots(boat);
                    const p  = pct(boat);
                    const bc = barColor(boat);
                    return (
                      <div key={boat.id} style={{ padding: "2px 4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 7, color: isToday ? "rgba(255,255,255,0.7)" : "#888" }}>
                            {boat.name === "Aloes Vera" ? "🛥️" : "🚤"}
                          </span>
                          <span style={{ fontSize: 8, fontWeight: 700, color: r <= 0 ? CORAL : "#FA9F6A" }}>
                            {r <= 0 ? "Complet 🚫" : `R${r}`}
                          </span>
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: isToday ? "rgba(255,255,255,0.2)" : "#ddd", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${p}%`, background: isToday ? "#fff" : bc, borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                  {dp > 0 && <div style={{ textAlign: "center", fontSize: 8, fontWeight: 700, color: isToday ? "rgba(255,255,255,0.8)" : TEAL, marginTop: 2 }}>{dp} pax</div>}
                </div>
              )}
            </button>
          );
        })}
      </div>
      </>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ADMIN VIEW
// ════════════════════════════════════════════════════════════════
function AdminView({ data, save, sources, saveSources, skData, saveSkData, reload }) {
  const [tab,      setTab]      = useState("planning");
  const [exp,      setExp]      = useState({});
  const [editing,  setEditing]  = useState(null);
  const [adding,   setAdding]   = useState(null);
  const [delBk,    setDelBk]    = useState(null);
  const [delDate,  setDelDate]  = useState(null);
  const [addDate,  setAddDate]  = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [impText,  setImpText]  = useState("");
  const [parsed,   setParsed]   = useState(null);
  const [toast,    setToast]    = useState(null);
  const [copied,   setCopied]   = useState(null);

  const notify = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  const toggle = id => setExp(e => ({ ...e, [id]: !e[id] }));

  const saveEdit = () => {
    const next = { ...data, dates: data.dates.map(d => d.id !== editing.dateId ? d : { ...d, boats: d.boats.map(b => b.id !== editing.boatId ? b : { ...b, bookings: b.bookings.map(bk => bk.id !== editing.bkId ? bk : { ...editing.form, id: bk.id }) }) }) };
    save(next); setEditing(null); notify("Modifiée ✓");
  };
  const saveAdd = () => {
    const next = { ...data, dates: data.dates.map(d => d.id !== adding.dateId ? d : { ...d, boats: d.boats.map(b => b.id !== adding.boatId ? b : { ...b, bookings: [...b.bookings, { ...adding.form, id: uid(), status: "confirmed", ts: Date.now() }] }) }) };
    save(next); setAdding(null); notify("Ajoutée ✓");
  };
  const doDelBk = (dateId, boatId, bkId) => {
    const next = { ...data, dates: data.dates.map(d => d.id !== dateId ? d : { ...d, boats: d.boats.map(b => b.id !== boatId ? b : { ...b, bookings: b.bookings.filter(bk => bk.id !== bkId) }) }) };
    save(next); setDelBk(null); notify("Supprimée");
  };
  const approve = p => {
    const next = { ...data, pending: data.pending.filter(x => x.id !== p.id), dates: data.dates.map(d => d.id !== p.dateId ? d : { ...d, boats: d.boats.map(b => b.id !== p.boatId ? b : { ...b, bookings: [...b.bookings, { ...p, status: "confirmed" }] }) }) };
    save(next); notify("Approuvée ✓");
  };
  const reject = p => { save({ ...data, pending: data.pending.filter(x => x.id !== p.id) }); notify("Refusée"); };
  const doDelDate = id => { save({ ...data, dates: data.dates.filter(d => d.id !== id) }); setDelDate(null); notify("Supprimée"); };
  const saveNewDate = () => {
    if (!newLabel.trim()) return;
    save({ ...data, dates: [...data.dates, makeDateEntry(newLabel.trim())] });
    setNewLabel(""); setAddDate(false); notify("Date ajoutée ✓");
  };
  const doImport = () => {
    if (!parsed?.length) return;
    const existing = new Set(data.dates.map(d => d.label));
    const newD = parsed.filter(d => !existing.has(d.label));
    save({ ...data, dates: [...data.dates, ...newD] });
    notify(`${newD.length} importée(s)${parsed.length - newD.length ? ` · ${parsed.length - newD.length} ignorée(s)` : ""}`);
    setImpText(""); setParsed(null); setTab("planning");
  };
  const copyWA = entry => {
    navigator.clipboard.writeText(toWA(entry)).then(() => { setCopied(entry.id); setTimeout(() => setCopied(null), 2000); notify("Copié 📋"); });
  };

  const gRev = data.dates.reduce((s, d) => s + d.boats.reduce((s2, b) => s2 + boatRev(b), 0), 0);
  const gPax = data.dates.reduce((s, d) => s + d.boats.reduce((s2, b) => s2 + boatPax(b), 0), 0);
  const gBk  = data.dates.reduce((s, d) => s + d.boats.reduce((s2, b) => s2 + b.bookings.length, 0), 0);


  return (
    <div style={{ minHeight: "100vh", width: "100%", overflowX: "hidden", boxSizing: "border-box", WebkitTextSizeAdjust:"100%", background: "#EBF7FA", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: DARK, color: "#fff", padding: "0 8px", height: 56, display: "flex", alignItems: "center", gap: 6, position: "sticky", top: 0, zIndex: 100, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <span style={{ fontSize: 22 }}>🐟</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Panamax · Admin</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 2, overflowX: "auto", WebkitOverflowScrolling: "touch", flexShrink: 1, minWidth: 0 }}>
            {[["planning", "📅 Planning"], ["stats", "📊 Stats"], ["compta", "🧾 Comptabilité"], ["skippers_mgmt", "⚓ Skippers"], ["revendeurs", "👥 Référents"], ["woo", "🛒 Woo"], ["import", "⬆️ Import"]].map(([v, lbl]) => (
              <button key={v} onClick={() => setTab(v)} style={{ background: tab === v ? "rgba(255,255,255,0.15)" : "transparent", color: tab === v ? "#fff" : "rgba(255,255,255,0.55)", border: "none", borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: tab === v ? 700 : 400, whiteSpace: "nowrap" }}>{lbl}</button>
            ))}
            <button onClick={reload} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, padding: "0 8px" }}>↻</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "12px 10px 80px", boxSizing: "border-box", width: "100%", overflowX: "hidden" }}>

        {/* ── Planning tab ── */}
        {tab === "planning" && (<>
          <Grid cols="repeat(auto-fit,minmax(90px,1fr))" gap={8} style={{ marginBottom: 14 }}>
            {[{ v: fmtEur(gRev), l: "Chiffre d'affaires", i: "💰" }, { v: gPax, l: "Passagers", i: "👥" }, { v: gBk, l: "Réservations", i: "📋" }].map(({ v, l, i }) => (
              <div key={l} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", textAlign: "center", border: "1px solid #e0eef3" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{i} {l}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: TEAL }}>{v}</div>
              </div>
            ))}
          </Grid>
          <AdminCalendar data={data} save={save} notify={notify} editing={editing} setEditing={setEditing} adding={adding} setAdding={setAdding} delBk={delBk} setDelBk={setDelBk} saveEdit={saveEdit} saveAdd={saveAdd} doDelBk={doDelBk} copied={copied} copyWA={copyWA} />


        </>)}

        {/* ── Comptabilité tab ── */}
        {tab === "compta" && <ComptaTab data={data} sources={sources} />}

        {/* ── Skippers management tab ── */}
        {tab === "skippers_mgmt" && <SkippersMgmtTab skData={skData} saveSkData={saveSkData} data={data} />}

        {/* ── WooCommerce tab ── */}
        {tab === "woo" && <WooTab data={data} save={save} notify={notify} />}

        {/* ── Import tab ── */}
        {tab === "import" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #deeaf0" }}>
            <h2 style={{ margin: "0 0 6px", color: TEAL, fontSize: 20 }}>📥 Importer le planning WhatsApp</h2>
            <p style={{ color: "#666", fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>Copiez-collez votre message WhatsApp ci-dessous.</p>
            <textarea style={{ width: "100%", height: 280, padding: 14, border: "1px solid #ddd", borderRadius: 10, fontSize: 12.5, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical", background: "#FAFBFC", lineHeight: 1.7 }}
              value={impText} onChange={e => { setImpText(e.target.value); setParsed(null); }}
              placeholder={"Planning Panamax: 115€/ad 95€/enf\n……………………\nMercredi 29/04\n🛥️Aloès Vera Full 💥\n4+4 Tschannen luc +33661226946 720€"} />
            <Row gap={10} style={{ marginTop: 14, flexWrap: "wrap" }}>
              <Btn onClick={() => { try { setParsed(parseWA(impText)); } catch { notify("Erreur parsing", false); } }} disabled={!impText.trim()}>🔍 Analyser</Btn>
              {parsed && <Btn variant="success" onClick={doImport}>✓ Importer {parsed.length} date(s)</Btn>}
              <Btn variant="ghost" onClick={() => { setImpText(""); setParsed(null); }}>Effacer</Btn>
            </Row>
            {parsed && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 700, color: TEAL, marginBottom: 10 }}>Aperçu — {parsed.length} date(s)</div>
                {parsed.map(d => (
                  <div key={d.id} style={{ background: "#F8FBFC", borderRadius: 9, padding: "10px 14px", marginBottom: 6, border: "1px solid #deeaf0", fontSize: 13 }}>
                    <strong style={{ color: TEAL }}>{d.label}</strong>
                    {d.boats.map(b => <div key={b.id} style={{ color: "#666", marginLeft: 8, marginTop: 3 }}>{b.name === "Aloes Vera" ? "🛥️ Aloès Vera" : "🚤 Panamax"} — {b.bookings.length} rés., {boatPax(b)} pax, {fmtEur(boatRev(b))}</div>)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: toast.ok ? TEAL : CORAL, color: "#fff", padding: "10px 24px", borderRadius: 28, fontSize: 14, fontWeight: 600, zIndex: 9999, whiteSpace: "nowrap" }}>{toast.msg}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ADMIN — SKIPPERS MANAGEMENT TAB
// ════════════════════════════════════════════════════════════════
function SkippersMgmtTab({ skData, saveSkData, data }) {
  const today = new Date();
  const [tab,      setTab]      = useState("planning");
  const [notif,    setNotif]    = useState(null);
  const [curMonth, setCurMonth] = useState(today.getMonth());
  const [curYear,  setCurYear]  = useState(today.getFullYear());
  const [editSk,   setEditSk]   = useState(null);
  const [editForm, setEditForm] = useState({});
  const [addingSk, setAddingSk] = useState(false);
  const [newSk,    setNewSk]    = useState({ name:"", pin:"", color:"#2471A3" });

  const toast = (msg, ok=true) => { setNotif({msg,ok}); setTimeout(()=>setNotif(null),3000); };
  const planning = skData?.planning || {};
  const skippers = skData?.skippers || [];

  const prevMonth = () => { if(curMonth===0){setCurYear(y=>y-1);setCurMonth(11);}else setCurMonth(m=>m-1); };
  const nextMonth = () => { if(curMonth===11){setCurYear(y=>y+1);setCurMonth(0);}else setCurMonth(m=>m+1); };

  const firstDay = new Date(curYear, curMonth, 1);
  const lastDay  = new Date(curYear, curMonth+1, 0);
  let startDow = firstDay.getDay(); startDow = startDow===0?6:startDow-1;
  const cells = Array(startDow).fill(null);
  for(let d=1;d<=lastDay.getDate();d++) cells.push(new Date(curYear,curMonth,d));

  const assignSkipper = (dateLabel, boatKey, skipperId) => {
    const p = { ...planning };
    if (!p[dateLabel]) p[dateLabel] = {};
    if (skipperId) p[dateLabel][boatKey] = skipperId;
    else { delete p[dateLabel][boatKey]; if(Object.keys(p[dateLabel]).length===0) delete p[dateLabel]; }
    saveSkData({ ...skData, planning: p });
  };

  const saveSkipper = () => {
    if (!editForm.name?.trim()) return;
    const updated = skippers.map(s => s.id===editSk.id ? { ...s, name:editForm.name, ...(editForm.pin?{pin:editForm.pin}:{}) } : s);
    saveSkData({ ...skData, skippers: updated });
    setEditSk(null); toast("Skipper modifié ✓");
  };

  const addSkipper = () => {
    if (!newSk.name.trim() || !newSk.pin.trim()) return;
    const id = newSk.name.toLowerCase().replace(/[^a-z0-9]/g,"_")+"_"+uid();
    saveSkData({ ...skData, skippers: [...skippers, { id, ...newSk, active:true }] });
    setAddingSk(false); setNewSk({ name:"", pin:"", color:"#2471A3" }); toast("Skipper ajouté ✓");
  };

  const toggleActive = (id) => {
    saveSkData({ ...skData, skippers: skippers.map(s => s.id===id ? {...s,active:!s.active} : s) });
  };

  const SK_COLORS = ["#2471A3","#8E44AD","#C0392B","#1E8449","#E67E22","#16A085","#1A5F7A","#7F8C8D"];

  const PlanningView = () => {
    const [dayModal, setDayModal] = useState(null);
    return (
      <div>
        <Row style={{ justifyContent:"space-between", marginBottom:14 }}>
          <button onClick={prevMonth} style={{ background:"#EBF7FA", border:"none", color:TEAL, width:36, height:36, borderRadius:18, cursor:"pointer", fontSize:18, fontWeight:700 }}>‹</button>
          <span style={{ fontSize:18, fontWeight:800, color:TEAL }}>{MONTHS[curMonth]} {curYear}</span>
          <button onClick={nextMonth} style={{ background:"#EBF7FA", border:"none", color:TEAL, width:36, height:36, borderRadius:18, cursor:"pointer", fontSize:18, fontWeight:700 }}>›</button>
        </Row>
        <Row gap={10} style={{ marginBottom:10, flexWrap:"wrap" }}>
          {skippers.filter(s=>s.active).map(s=>(
            <Row key={s.id} gap={5} style={{ fontSize:12, color:"#555" }}>
              <div style={{ width:10,height:10,borderRadius:5,background:s.color,flexShrink:0 }}/>{s.name}
            </Row>
          ))}
        </Row>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:2, marginBottom:2 }}>
          {DAYS_SHORT.map(d=><div key={d} style={{ textAlign:"center", fontSize:10, fontWeight:700, color:"#888", padding:"2px 0" }}>{d}</div>)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:2, marginBottom:14 }}>
          {cells.map((cell,i) => {
            if (!cell) return <div key={"e"+i}/>;
            const label  = labelFromDate(cell);
            const assign = planning[label] || {};
            const isToday= cell.toDateString()===today.toDateString();
            const aSk    = skippers.find(s=>s.id===assign.aloes);
            const pSk    = skippers.find(s=>s.id===assign.panamax);
            return (
              <button key={cell.toISOString()} onClick={()=>setDayModal({label})}
                style={{ background:isToday?`${TEAL}18`:(aSk||pSk)?"#F0F8FB":"#fff", border:isToday?`2px solid ${TEAL}`:"1px solid #eee", borderRadius:7, padding:"4px 2px", cursor:"pointer", minHeight:56, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                <span style={{ fontSize:11, fontWeight:isToday?800:500, color:isToday?TEAL:DARK }}>{cell.getDate()}</span>
                {aSk&&<div style={{ fontSize:7, background:aSk.color, color:"#fff", borderRadius:3, padding:"1px 3px", fontWeight:700, width:"100%", textAlign:"center", overflow:"hidden" }}>🛥 {aSk.name}</div>}
                {pSk&&<div style={{ fontSize:7, background:pSk.color, color:"#fff", borderRadius:3, padding:"1px 3px", fontWeight:700, width:"100%", textAlign:"center", overflow:"hidden" }}>🚤 {pSk.name}</div>}
              </button>
            );
          })}
        </div>
        {dayModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div style={{ background:"#fff", borderRadius:16, padding:24, maxWidth:360, width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
              <Row style={{ marginBottom:18 }}>
                <span style={{ fontWeight:800, color:TEAL, fontSize:16 }}>📅 {dayModal.label}</span>
                <button onClick={()=>setDayModal(null)} style={{ marginLeft:"auto", background:"none", border:"none", cursor:"pointer", fontSize:22, color:"#bbb", lineHeight:1 }}>✕</button>
              </Row>
              {[{key:"aloes",icon:"🛥️",name:"Aloès Vera"},{key:"panamax",icon:"🚤",name:"Panamax"}].map(boat=>(
                <div key={boat.key} style={{ marginBottom:14 }}>
                  <Label>{boat.icon} {boat.name}</Label>
                  <select value={planning[dayModal.label]?.[boat.key]||""} onChange={e=>assignSkipper(dayModal.label,boat.key,e.target.value)} style={inputStyle}>
                    <option value="">— Non assigné —</option>
                    {skippers.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              ))}
              <Btn full onClick={()=>setDayModal(null)} style={{ marginTop:4 }}>Fermer</Btn>
            </div>
          </div>
        )}
      </div>
    );
  };

  const AccountsView = () => (
    <div>
      <Row style={{ marginBottom:16 }}>
        <h3 style={{ margin:0, color:TEAL }}>Comptes skippers</h3>
        <div style={{ marginLeft:"auto" }}><Btn onClick={()=>{ setAddingSk(true); setEditSk(null); }}>+ Ajouter</Btn></div>
      </Row>
      {addingSk && (
        <div style={{ background:"#F0F8FB", borderRadius:12, padding:16, marginBottom:14, border:`1px solid ${TEAL}30` }}>
          <div style={{ fontWeight:700, color:TEAL, marginBottom:14 }}>+ Nouveau skipper</div>
          <Grid cols="1fr 1fr" gap={10} style={{ marginBottom:12 }}>
            <FInput label="Nom" value={newSk.name} onChange={e=>setNewSk(f=>({...f,name:e.target.value}))} placeholder="Prénom..." />
            <FInput label="Code PIN" type="password" value={newSk.pin} onChange={e=>setNewSk(f=>({...f,pin:e.target.value}))} placeholder="4+ chiffres" />
          </Grid>
          <div style={{ marginBottom:12 }}>
            <Label>Couleur</Label>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:4 }}>
              {SK_COLORS.map(c=>(
                <button key={c} onClick={()=>setNewSk(f=>({...f,color:c}))} style={{ width:28, height:28, borderRadius:14, background:c, border:newSk.color===c?"3px solid #fff":"3px solid transparent", outline:newSk.color===c?`2px solid ${c}`:"none", cursor:"pointer" }}/>
              ))}
            </div>
          </div>
          <Row gap={8}>
            <Btn onClick={addSkipper} disabled={!newSk.name.trim()||!newSk.pin.trim()}>Enregistrer</Btn>
            <Btn variant="ghost" onClick={()=>setAddingSk(false)}>Annuler</Btn>
          </Row>
        </div>
      )}
      {skippers.map(sk => {
        const isEd = editSk?.id===sk.id;
        return (
          <div key={sk.id} style={{ background:"#fff", borderRadius:10, border:"1px solid #e0eef3", marginBottom:8, overflow:"hidden" }}>
            {isEd ? (
              <div style={{ padding:14, background:"#F0F8FB" }}>
                <Grid cols="1fr 1fr" gap={10} style={{ marginBottom:12 }}>
                  <FInput label="Nom" value={editForm.name||""} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} />
                  <FInput label="Nouveau PIN" type="password" value={editForm.pin||""} onChange={e=>setEditForm(f=>({...f,pin:e.target.value}))} placeholder="Laisser vide = inchangé" />
                </Grid>
                <Row gap={8}><Btn small onClick={saveSkipper}>Enregistrer</Btn><Btn small variant="ghost" onClick={()=>setEditSk(null)}>Annuler</Btn></Row>
              </div>
            ) : (
              <Row style={{ padding:"12px 14px" }}>
                <div style={{ width:34,height:34,borderRadius:17,background:sk.color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:15,flexShrink:0 }}>{sk.name[0]}</div>
                <div style={{ flex:1, marginLeft:10 }}>
                  <div style={{ fontWeight:700, color:DARK }}>{sk.name}</div>
                  <div style={{ fontSize:11, color:sk.active?GREEN:"#bbb" }}>{sk.active?"● Actif":"○ Inactif"}</div>
                </div>
                <Row gap={6}>
                  <button onClick={()=>{ setEditSk(sk); setEditForm({name:sk.name,pin:""}); setAddingSk(false); }} style={{ background:"#EBF7FA", border:"none", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:12, color:TEAL, fontWeight:600 }}>✏️ Modifier</button>
                  <button onClick={()=>toggleActive(sk.id)} style={{ background:sk.active?"#FEF0EB":"#E8F8F1", border:"none", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:12, color:sk.active?CORAL:GREEN, fontWeight:600 }}>{sk.active?"Désactiver":"Activer"}</button>
                </Row>
              </Row>
            )}
          </div>
        );
      })}
    </div>
  );

  const RecapView = () => {
    const allBk = data.dates.flatMap(date =>
      date.boats.flatMap(boat =>
        boat.bookings.filter(bk=>bk.paiements_solde?.length>0).map(bk=>({...bk,dateLabel:date.label}))
      )
    );
    const bySkipper = {};
    const byMethod  = { cb:0, cash:0, ancv:0 };
    for (const bk of allBk) {
      const skId = bk.skipper_encaisseur||"inconnu";
      if (!bySkipper[skId]) bySkipper[skId]={ total:0,cb:0,cash:0,ancv:0,count:0 };
      for (const p of (bk.paiements_solde||[])) {
        bySkipper[skId][p.methode]=(bySkipper[skId][p.methode]||0)+p.montant;
        bySkipper[skId].total+=p.montant;
        byMethod[p.methode]=(byMethod[p.methode]||0)+p.montant;
      }
      bySkipper[skId].count++;
    }
    const total = Object.values(byMethod).reduce((s,v)=>s+v,0);
    return (
      <div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))", gap:8, marginBottom:14 }}>
          {PAY_METHODS.map(m=>(
            <div key={m.id} style={{ background:m.color, borderRadius:10, padding:"12px 10px", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.75)", marginBottom:4 }}>{m.icon} {m.label}</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#fff" }}>{fmtEur(byMethod[m.id]||0)}</div>
            </div>
          ))}
        </div>
        <div style={{ background:"#fff", borderRadius:12, padding:"14px 16px", marginBottom:14, border:"1px solid #deeaf0", textAlign:"center" }}>
          <div style={{ fontSize:12, color:"#888", marginBottom:3 }}>💰 Total encaissé soldes</div>
          <div style={{ fontSize:26, fontWeight:800, color:TEAL }}>{fmtEur(total)}</div>
        </div>
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #deeaf0", overflow:"hidden" }}>
          <div style={{ padding:"10px 16px", borderBottom:"1px solid #f0f5f7", fontWeight:700, color:TEAL, fontSize:13 }}>Par skipper encaisseur</div>
          {Object.entries(bySkipper).map(([skId,stats])=>{
            const sk=skippers.find(s=>s.id===skId);
            return (
              <Row key={skId} style={{ padding:"10px 16px", borderBottom:"1px solid #f5f8fa", gap:10 }}>
                <div style={{ width:30,height:30,borderRadius:15,background:sk?.color||"#999",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:13,flexShrink:0 }}>{(sk?.name||"?")[0]}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:DARK, fontSize:13 }}>{sk?.name||skId}</div>
                  <div style={{ fontSize:11, color:"#888" }}>
                    {stats.count} encaissement(s)
                    {stats.cb>0&&<span> · 💳 {fmtEur(stats.cb)}</span>}
                    {stats.cash>0&&<span> · 💵 {fmtEur(stats.cash)}</span>}
                    {stats.ancv>0&&<span> · 🎫 {fmtEur(stats.ancv)}</span>}
                  </div>
                </div>
                <span style={{ fontWeight:800, color:TEAL, fontSize:14 }}>{fmtEur(stats.total)}</span>
              </Row>
            );
          })}
          {Object.keys(bySkipper).length===0&&<div style={{ padding:20, textAlign:"center", color:"#bbb", fontSize:13 }}>Aucun encaissement enregistré.</div>}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display:"flex", background:"#EBF7FA", borderRadius:10, padding:3, marginBottom:16, width:"fit-content", flexWrap:"wrap", gap:2 }}>
        {[["planning","🗓️ Planning"],["accounts","👤 Comptes"],["recap","💰 Encaissements"]].map(([v,lbl])=>(
          <button key={v} onClick={()=>setTab(v)} style={{ background:tab===v?"#fff":"transparent", border:"none", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontSize:12, fontWeight:tab===v?700:400, color:tab===v?TEAL:"#888", boxShadow:tab===v?"0 1px 4px rgba(0,0,0,0.1)":"none" }}>{lbl}</button>
        ))}
      </div>
      {tab==="planning" && <PlanningView />}
      {tab==="accounts" && <AccountsView />}
      {tab==="recap"    && <RecapView />}
      {notif&&<div style={{ position:"fixed",bottom:22,left:"50%",transform:"translateX(-50%)",background:notif.ok?TEAL:CORAL,color:"#fff",padding:"10px 24px",borderRadius:28,fontSize:14,fontWeight:600,zIndex:9999 }}>{notif.msg}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SKIPPER GATE — PIN LOGIN
// ════════════════════════════════════════════════════════════════
function SkipperGate({ skData, onLogin, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const check = () => {
    const sk = (skData?.skippers || []).find(s => s.pin === pin && s.active);
    if (sk) { onLogin(sk); }
    else { setErr(true); setPin(""); setTimeout(() => setErr(false), 1500); }
  };
  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(160deg,#0D3D52 0%,#1A5F7A 60%,#2E86AB 100%)`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:40, textAlign:"center", maxWidth:320, width:"100%" }}>
        <div style={{ fontSize:48, marginBottom:8 }}>⚓</div>
        <h2 style={{ color:TEAL, margin:"0 0 6px" }}>Accès Skipper</h2>
        <p style={{ color:"#888", fontSize:14, marginBottom:24 }}>Entrez votre code PIN</p>
        <input type="password" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&check()}
          placeholder="Code PIN"
          style={{ width:"100%", padding:"12px 14px", border:`2px solid ${err?CORAL:"#ddd"}`, borderRadius:10, fontSize:18, textAlign:"center", boxSizing:"border-box", letterSpacing:8, marginBottom:12 }} />
        {err && <p style={{ color:CORAL, fontSize:13, margin:"0 0 10px" }}>Code incorrect</p>}
        <Btn full onClick={check} style={{ padding:12, fontSize:15, marginBottom:10 }}>Accéder →</Btn>
        <button onClick={onCancel} style={{ background:"none", border:"none", color:"#aaa", cursor:"pointer", fontSize:13 }}>Retour</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SKIPPER VIEW
// ════════════════════════════════════════════════════════════════
const PAY_METHODS = [
  { id:"cb",   label:"CB",          icon:"💳", color:"#2471A3" },
  { id:"cash", label:"Cash",        icon:"💵", color:"#1E8449" },
  { id:"ancv", label:"Chèque Vac.", icon:"🎫", color:"#009B77" },
];

function SkipperView({ data, save, skData, saveSkData, skipperUser, onLogout }) {
  const today = new Date();
  const [tab,     setTab]     = useState("today");   // today | planning | exchange
  const [selDate, setSelDate] = useState(null);       // date entry for encaissement
  const [selBk,   setSelBk]   = useState(null);       // booking being paid
  const [payForm, setPayForm] = useState([]);          // [{ methode, montant }]
  const [notif,   setNotif]   = useState(null);
  const [exchReq, setExchReq] = useState(null);       // exchange request being composed

  const toast = (msg, ok=true) => { setNotif({msg,ok}); setTimeout(()=>setNotif(null),3000); };

  // Get today's date entry
  const todayLabel = labelFromDate(today);
  const todayEntry = data.dates.find(d => d.label === todayLabel);

  // All bookings across all dates for this skipper's planning
  const myPlanningDates = Object.entries(skData?.planning || {})
    .filter(([label, assignment]) => assignment?.aloes === skipperUser.id || assignment?.panamax === skipperUser.id)
    .map(([label]) => label)
    .sort();

  // Save payment for a booking
  const savePayment = () => {
    const total = payForm.reduce((s, p) => s + (p.montant||0), 0);
    const bkReste = Math.max(0, selBk.price - (selBk.acompte_amount||0));
    if (total > bkReste) { toast("Montant supérieur au reste à payer", false); return; }

    const updatedBk = {
      ...selBk,
      paiements_solde: payForm.filter(p => p.montant > 0),
      skipper_encaisseur: skipperUser.id,
      solde_encaisse: total,
      solde_date: new Date().toISOString(),
    };

    const next = { ...data, dates: data.dates.map(d => d.label !== selDate.label ? d : {
      ...d, boats: d.boats.map(b => ({ ...b, bookings: b.bookings.map(bk => bk.id !== selBk.id ? bk : updatedBk) }))
    })};
    save(next);
    setSelBk(null); setPayForm([]);
    toast("Solde encaissé ✓");
    const methodsStr = payForm.filter(p=>p.montant>0).map(p=>`${PAY_METHODS.find(m=>m.id===p.methode)?.label||p.methode} ${p.montant}€`).join(' + ');
    sendTelegramNotif(`💳 Solde encaissé\n⚓ ${skipperUser.name}\n👤 ${selBk.name}\n📅 ${selDate?.label||todayLabel}\n💰 ${methodsStr}`);
  };

  // Move booking from one boat to another
  const moveBooking = (bk, fromBoat, toBoat, dateEntry) => {
    const next = { ...data, dates: data.dates.map(d => d.label !== dateEntry.label ? d : {
      ...d, boats: d.boats.map(b => {
        if (b.id === fromBoat.id) return { ...b, bookings: b.bookings.filter(x => x.id !== bk.id) };
        if (b.id === toBoat.id)   return { ...b, bookings: [...b.bookings, bk] };
        return b;
      })
    })};
    save(next);
    toast(`${bk.name} déplacé vers ${toBoat.name === "Aloes Vera" ? "Aloès Vera" : toBoat.name} ✓`);
  };

  // Assign skipper to boat for a date
  const assignSkipper = (dateLabel, boatKey, skipperId) => {
    const planning = { ...(skData?.planning || {}) };
    if (!planning[dateLabel]) planning[dateLabel] = {};
    planning[dateLabel][boatKey] = skipperId;
    saveSkData({ ...skData, planning });
    toast("Planning mis à jour ✓");
  };

  // Exchange planning between skippers (no admin validation needed)
  const doExchange = (myDate, myBoat, theirDate, theirBoat) => {
    const planning = { ...(skData?.planning || {}) };
    const mySkipper    = skipperUser.id;
    const otherSkipper = (skData?.skippers || []).find(s => s.id !== mySkipper)?.id;
    if (!otherSkipper) return;

    // Swap assignments
    if (!planning[myDate])    planning[myDate]    = {};
    if (!planning[theirDate]) planning[theirDate] = {};
    const tmp = planning[myDate][myBoat];
    planning[myDate][myBoat]       = planning[theirDate]?.[theirBoat] || otherSkipper;
    planning[theirDate][theirBoat] = tmp || mySkipper;

    saveSkData({ ...skData, planning });
    setExchReq(null);
    toast("Échange effectué ✓");
  };


  // ── ALL DATES TAB ─────────────────────────────────────────
  const AllDatesTab = () => {
    const [selEntry, setSelEntry] = useState(null); // date entry selected for detail
    const [selBkPay, setSelBkPay] = useState(null);
    const [payFormAll, setPayFormAll] = useState([]);

    // Sort all dates chronologically — today and future only
    const todayMidnight = new Date(new Date().setHours(0,0,0,0));
    const sortedDates = [...data.dates]
      .map(d => ({ ...d, _date: dateFromLabel(d.label) }))
      .filter(d => !d._date || d._date >= todayMidnight)
      .sort((a, b) => (a._date||new Date(0)) - (b._date||new Date(0)));

    const savePaymentAll = (dateEntry) => {
      const total = payFormAll.reduce((s, p) => s + (p.montant||0), 0);
      const reste = Math.max(0, selBkPay.price - (selBkPay.acompte_amount||0) - (selBkPay.solde_encaisse||0));
      if (total > reste) { toast("Montant supérieur au reste à payer", false); return; }
      const updatedBk = {
        ...selBkPay,
        paiements_solde: payFormAll.filter(p => p.montant > 0),
        skipper_encaisseur: skipperUser.id,
        solde_encaisse: (selBkPay.solde_encaisse||0) + total,
        solde_date: new Date().toISOString(),
      };
      const next = { ...data, dates: data.dates.map(d => d.label !== dateEntry.label ? d : {
        ...d, boats: d.boats.map(b => ({ ...b, bookings: b.bookings.map(bk => bk.id !== selBkPay.id ? bk : updatedBk) }))
      })};
      save(next);
      setSelBkPay(null); setPayFormAll([]);
      toast("Solde encaissé ✓");
    };

    // Detail view for a selected date
    if (selEntry) {
      const entry = data.dates.find(d => d.label === selEntry);
      if (!entry) { setSelEntry(null); return null; }
      const planning = skData?.planning?.[entry.label] || {};
      const allBk = entry.boats.flatMap(boat => boat.bookings.map(bk => ({...bk, boat})));
      const totalReste = allBk.reduce((s,bk) => s + Math.max(0, bk.price-(bk.acompte_amount||0)-(bk.solde_encaisse||0)), 0);

      return (
        <div>
          <button onClick={() => { setSelEntry(null); setSelBkPay(null); setPayFormAll([]); }}
            style={{ background:"#EBF7FA", border:"none", borderRadius:8, padding:"7px 16px", cursor:"pointer", color:TEAL, fontWeight:700, fontSize:13, marginBottom:14, display:"flex", alignItems:"center", gap:6 }}>
            ← Toutes les dates
          </button>

          <div style={{ background:"#fff", borderRadius:14, padding:"14px 16px", marginBottom:12, border:"1px solid #deeaf0" }}>
            <div style={{ fontWeight:800, color:TEAL, fontSize:16, marginBottom:6 }}>📅 {entry.label}</div>
            <Row gap={12} style={{ flexWrap:"wrap" }}>
              <span style={{ fontSize:12, color:"#888" }}>👥 {allBk.reduce((s,b)=>s+b.adults+b.children,0)} passager(s)</span>
              <span style={{ fontSize:12, color:"#888" }}>📋 {allBk.length} réservation(s)</span>
              {totalReste > 0 && <span style={{ fontSize:12, fontWeight:700, color:CORAL }}>💰 À encaisser : {fmtEur(totalReste)}</span>}
              {totalReste === 0 && allBk.length > 0 && <span style={{ fontSize:12, fontWeight:700, color:GREEN }}>✅ Tout soldé</span>}
            </Row>
            {/* Skipper assignment */}
            {(planning.aloes || planning.panamax) && (
              <Row gap={8} style={{ marginTop:8, flexWrap:"wrap" }}>
                {planning.aloes  && <span style={{ fontSize:11, background:"#EBF7FA", color:TEAL, padding:"2px 10px", borderRadius:7, fontWeight:600 }}>🛥️ {(skData?.skippers||[]).find(s=>s.id===planning.aloes)?.name||planning.aloes}</span>}
                {planning.panamax&& <span style={{ fontSize:11, background:"#EBF7FA", color:TEAL, padding:"2px 10px", borderRadius:7, fontWeight:600 }}>🚤 {(skData?.skippers||[]).find(s=>s.id===planning.panamax)?.name||planning.panamax}</span>}
              </Row>
            )}
          </div>

          {entry.boats.map(boat => {
            const icon = boat.name==="Aloes Vera"?"🛥️":"🚤";
            const dname = boat.name==="Aloes Vera"?"Aloès Vera":boat.name;
            const otherBoat = entry.boats.find(b=>b.id!==boat.id);

            return (
              <div key={boat.id} style={{ background:"#fff", borderRadius:14, marginBottom:10, border:"1px solid #deeaf0", overflow:"hidden" }}>
                <div style={{ background:"#F0F8FB", padding:"10px 14px", borderBottom:"1px solid #e8f2f7" }}>
                  <Row>
                    <span style={{ fontSize:18 }}>{icon}</span>
                    <span style={{ fontWeight:800, color:TEAL, fontSize:14, flex:1, marginLeft:8 }}>{dname}</span>
                    <span style={{ fontSize:12, color:"#888" }}>{boatPax(boat)} pax · {fmtEur(boatRev(boat))}</span>
                  </Row>
                </div>
                {boat.bookings.length === 0 && <div style={{ padding:"12px 14px", color:"#bbb", fontSize:13, textAlign:"center" }}>Aucune réservation</div>}
                {boat.bookings.map(bk => {
                  const reste   = Math.max(0, bk.price-(bk.acompte_amount||0)-(bk.solde_encaisse||0));
                  const soldé   = reste <= 0;
                  const isPaying= selBkPay?.id===bk.id;
                  const src     = SOURCES[bk.source]?.label || bk.source || "?";
                  const srcCol  = SOURCES[bk.source]?.color || "#999";

                  return (
                    <div key={bk.id} style={{ borderBottom:"1px solid #f5f8fa", padding:"12px 14px" }}>
                      <Row style={{ marginBottom:4 }}>
                        <span style={{ background:srcCol, color:"#fff", fontSize:10, padding:"2px 8px", borderRadius:7, fontWeight:700, flexShrink:0 }}>{src}</span>
                        <div style={{ flex:1, marginLeft:8 }}>
                          <div style={{ fontWeight:700, color:DARK, fontSize:13 }}>{bk.name}</div>
                          <div style={{ fontSize:11, color:"#888" }}>
                            👥 {bk.adults}ad{bk.children?`+${bk.children}enf`:""}
                            
                          </div>
                          {bk.paiements_solde?.length>0 && (
                            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:3 }}>
                              {bk.paiements_solde.map((p,i)=>{
                                const m=PAY_METHODS.find(x=>x.id===p.methode);
                                return <span key={i} style={{ fontSize:9, fontWeight:700, background:m?.color||"#999", color:"#fff", padding:"2px 6px", borderRadius:5 }}>{m?.icon} {fmtEur(p.montant)}</span>;
                              })}
                            </div>
                          )}
                          {bk.notes && (
                            <div style={{ marginTop:5, fontSize:11, color:"#666", fontStyle:"italic", background:"#F8FBFC", borderRadius:6, padding:"5px 8px", border:"1px solid #e8eef3" }}>
                              📝 {bk.notes}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <div style={{ fontWeight:800, fontSize:14, color:soldé?GREEN:CORAL }}>{soldé?"✅":fmtEur(reste)}</div>
                          <div style={{ fontSize:10, color:"#aaa" }}>{fmtEur(bk.price)} total</div>
                        </div>
                      </Row>
                      {!soldé && (
                        <Row gap={8} style={{ marginTop:6 }}>
                          <Btn small onClick={() => {
                            setSelBkPay(bk);
                            setPayFormAll([{methode:"cb",montant:reste},{methode:"cash",montant:0},{methode:"ancv",montant:0}]);
                          }}>💳 Encaisser</Btn>
                          <StripeButton bk={bk} dateLabel={entry.label} dateId={entry.id} boatId={boat.id} small />
                          {otherBoat && (
                            <button onClick={() => moveBooking(bk, boat, otherBoat, entry)}
                              style={{ background:"#EBF7FA", border:`1px solid ${TEAL}40`, borderRadius:6, padding:"4px 9px", cursor:"pointer", fontSize:11, color:TEAL, fontWeight:600 }}>
                              → {otherBoat.name==="Aloes Vera"?"Aloès":"Panamax"}
                            </button>
                          )}
                          {bk.phone && (() => {
                            const tel = fullPhone(bk);
                            return (
                              <Row gap={5}>
                                <a href={`https://wa.me/${tel.replace(/[^0-9]/g,"")}`} target="_blank" rel="noreferrer"
                                  style={{ background:"#25D366", color:"#fff", borderRadius:6, padding:"4px 8px", textDecoration:"none", fontSize:11, fontWeight:700 }}>WA</a>
                                <a href={`tel:${tel}`}
                                  style={{ background:TEAL, color:"#fff", borderRadius:6, padding:"4px 8px", textDecoration:"none", fontSize:11, fontWeight:700 }}>📞</a>
                              </Row>
                            );
                          })()}
                        </Row>
                      )}
                      {isPaying && (
                        <div style={{ background:"#F0F8FB", borderRadius:10, padding:12, marginTop:10, border:`1px solid ${TEAL}30` }}>
                          <div style={{ fontWeight:700, color:TEAL, fontSize:12, marginBottom:10 }}>Encaissement — {bk.name} (reste : {fmtEur(reste)})</div>
                          {PAY_METHODS.map(m=>(
                            <Row key={m.id} gap={8} style={{ marginBottom:7, alignItems:"center" }}>
                              <span style={{ background:m.color,color:"#fff",fontSize:10,padding:"2px 8px",borderRadius:7,fontWeight:700,minWidth:70,textAlign:"center" }}>{m.icon} {m.label}</span>
                              <input type="number" min="0" value={payFormAll.find(p=>p.methode===m.id)?.montant||0}
                                onChange={e=>setPayFormAll(f=>f.map(p=>p.methode===m.id?{...p,montant:Math.max(0,+e.target.value)}:p))}
                                style={{ ...inputStyle, flex:1 }} placeholder="0" />
                              <span style={{ fontSize:11, color:"#888" }}>€</span>
                            </Row>
                          ))}
                          <div style={{ fontSize:11, color:"#888", marginBottom:10 }}>
                            Total : <strong style={{ color:payFormAll.reduce((s,p)=>s+p.montant,0)===reste?GREEN:CORAL }}>{fmtEur(payFormAll.reduce((s,p)=>s+p.montant,0))}</strong> / {fmtEur(reste)}
                          </div>
                          <Row gap={8}>
                            <Btn small variant="success" onClick={()=>savePaymentAll(entry)} disabled={payFormAll.reduce((s,p)=>s+p.montant,0)===0}>✓ Valider</Btn>
                            <Btn small variant="ghost" onClick={()=>{ setSelBkPay(null); setPayFormAll([]); }}>Annuler</Btn>
                          </Row>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    }

    // List view — all dates
    return (
      <div>
        {sortedDates.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 16px", color:"#888" }}>
            <div style={{ fontSize:40, marginBottom:10 }}>📋</div>
            <p>Aucune réservation dans l'application.</p>
          </div>
        )}
        {sortedDates.map(entry => {
          const allBk  = entry.boats.flatMap(b => b.bookings);
          const dp     = allBk.reduce((s,b)=>s+b.adults+b.children,0);
          const dr     = allBk.reduce((s,b)=>s+b.price,0);
          const reste  = allBk.reduce((s,b)=>s+Math.max(0,b.price-(b.acompte_amount||0)-(b.solde_encaisse||0)),0);
          const isToday= entry.label === todayLabel;
          const isPast = entry._date && entry._date < new Date(new Date().setHours(0,0,0,0));

          return (
            <button key={entry.label} onClick={() => setSelEntry(entry.label)}
              style={{ width:"100%", textAlign:"left", background:isToday?"#EBF7FA":isPast?"#FAFAFA":"#fff", borderRadius:12, padding:"13px 16px", marginBottom:8, border:isToday?`2px solid ${TEAL}`:"1px solid #e0eef3", cursor:"pointer", opacity:isPast?0.7:1 }}>
              <Row style={{ marginBottom:4 }}>
                <span style={{ fontWeight:800, color:isToday?TEAL:DARK, fontSize:14, flex:1 }}>
                  {isToday && <span style={{ background:TEAL, color:"#fff", fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:6, marginRight:7 }}>Aujourd'hui</span>}
                  {entry.label}
                </span>
                <span style={{ fontSize:12, color:"#aaa" }}>→</span>
              </Row>
              <Row gap={14} style={{ flexWrap:"wrap" }}>
                <span style={{ fontSize:12, color:"#888" }}>👥 {dp} pax</span>
                <span style={{ fontSize:12, color:"#888" }}>📋 {allBk.length} rés.</span>
                <span style={{ fontSize:12, fontWeight:700, color:TEAL }}>{fmtEur(dr)}</span>
                {reste > 0 && <span style={{ fontSize:12, fontWeight:700, color:CORAL }}>Reste : {fmtEur(reste)}</span>}
                {reste === 0 && allBk.length > 0 && <span style={{ fontSize:12, fontWeight:700, color:GREEN }}>✅ Soldé</span>}
              </Row>
            </button>
          );
        })}
      </div>
    );
  };


  // ── TODAY TAB ──────────────────────────────────────────────
  const TodayTab = () => {
    const [openBkId, setOpenBkId] = useState(null);

    if (!todayEntry) return (
      <div style={{ textAlign:"center", padding:"40px 16px", color:"#888" }}>
        <div style={{ fontSize:40, marginBottom:10 }}>📅</div>
        <p>Aucune sortie planifiée aujourd'hui.</p>
        <div style={{ fontSize:13, color:"#aaa", marginTop:8 }}>{todayLabel}</div>
      </div>
    );

    const planning = skData?.planning?.[todayLabel] || {};
    const otherSkippers = (skData?.skippers || []).filter(s => s.id !== skipperUser.id);

    return (
      <div>
        {/* Assign skippers to boats */}
        <div style={{ background:"#fff", borderRadius:14, padding:"16px 18px", marginBottom:14, border:"1px solid #deeaf0" }}>
          <div style={{ fontWeight:700, color:TEAL, fontSize:14, marginBottom:12 }}>⚓ Affectation des skippers</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10 }}>
            {todayEntry.boats.map(boat => {
              const boatKey   = boat.name === "Aloes Vera" ? "aloes" : "panamax";
              const assigned  = planning[boatKey];
              const allSkip   = skData?.skippers || [];
              return (
                <div key={boat.id} style={{ background:"#F0F8FB", borderRadius:10, padding:"12px 14px", border:`1px solid ${TEAL}20` }}>
                  <div style={{ fontSize:13, fontWeight:700, color:DARK, marginBottom:8 }}>
                    {boat.name === "Aloes Vera" ? "🛥️ Aloès Vera" : "🚤 Panamax"}
                  </div>
                  <select value={assigned||""} onChange={e => assignSkipper(todayLabel, boatKey, e.target.value)}
                    style={{ ...inputStyle, fontSize:13, fontWeight:600 }}>
                    <option value="">— Skipper —</option>
                    {allSkip.filter(s=>s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {assigned && <div style={{ fontSize:11, color:GREEN, marginTop:4, fontWeight:600 }}>
                    ✓ {allSkip.find(s=>s.id===assigned)?.name}
                  </div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bookings per boat */}
        {todayEntry.boats.map(boat => {
          const icon = boat.name === "Aloes Vera" ? "🛥️" : "🚤";
          const dname = boat.name === "Aloes Vera" ? "Aloès Vera" : boat.name;
          const otherBoat = todayEntry.boats.find(b => b.id !== boat.id);
          const totalReste = boat.bookings.reduce((s,bk) => s + Math.max(0, bk.price - (bk.acompte_amount||0) - (bk.solde_encaisse||0)), 0);

          return (
            <div key={boat.id} style={{ background:"#fff", borderRadius:14, marginBottom:12, border:"1px solid #deeaf0", overflow:"hidden" }}>
              <div style={{ background:"#F0F8FB", padding:"12px 16px", borderBottom:"1px solid #e8f2f7" }}>
                <Row>
                  <span style={{ fontSize:20 }}>{icon}</span>
                  <span style={{ fontWeight:800, color:TEAL, fontSize:15, flex:1, marginLeft:8 }}>{dname}</span>
                  <span style={{ fontSize:12, color:"#888" }}>{boatPax(boat)} pax</span>
                  {totalReste > 0 && <span style={{ fontSize:12, fontWeight:700, color:CORAL, marginLeft:10 }}>À encaisser : {fmtEur(totalReste)}</span>}
                </Row>
              </div>

              {boat.bookings.length === 0 && (
                <div style={{ padding:"16px", textAlign:"center", color:"#bbb", fontSize:13 }}>Aucune réservation</div>
              )}

              {boat.bookings.map(bk => {
                const reste      = Math.max(0, bk.price - (bk.acompte_amount||0) - (bk.solde_encaisse||0));
                const soldé      = reste <= 0;
                const isOpen     = openBkId === bk.id;
                const isPaying   = selBk?.id === bk.id;

                return (
                  <div key={bk.id} style={{ borderBottom:"1px solid #f5f8fa" }}>
                    <div style={{ padding:"12px 16px" }}>
                      <Row style={{ marginBottom:6 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, color:DARK, fontSize:13 }}>{bk.name}</div>
                          <div style={{ fontSize:11, color:"#888", marginTop:2 }}>
                            👥 {bk.adults}ad{bk.children?`+${bk.children}enf`:""} · {fmtEur(bk.price)}
                            
                          </div>
                          {/* Payment methods already collected */}
                          {bk.paiements_solde?.length > 0 && (
                            <div style={{ marginTop:4, display:"flex", gap:4, flexWrap:"wrap" }}>
                              {bk.paiements_solde.map((p,i) => {
                                const m = PAY_METHODS.find(x=>x.id===p.methode);
                                return <span key={i} style={{ fontSize:10, fontWeight:700, background:m?.color||"#999", color:"#fff", padding:"2px 7px", borderRadius:6 }}>{m?.icon} {m?.label} {fmtEur(p.montant)}</span>;
                              })}
                            </div>
                          )}
                          {bk.notes && (
                            <div style={{ marginTop:5, fontSize:11, color:"#555", fontStyle:"italic", background:"rgba(255,255,255,0.15)", borderRadius:6, padding:"5px 8px", border:"1px solid rgba(255,255,255,0.2)" }}>
                              📝 {bk.notes}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          {soldé
                            ? <span style={{ fontSize:12, fontWeight:700, color:GREEN }}>✅ Soldé</span>
                            : <span style={{ fontSize:14, fontWeight:800, color:CORAL }}>{fmtEur(reste)}</span>
                          }
                        </div>
                      </Row>

                      {/* Actions */}
                      {!soldé && (
                        <Row gap={8} style={{ marginTop:6 }}>
                          <Btn small onClick={() => {
                            setSelBk(bk);
                            setPayForm([{ methode:"cb", montant: reste }, { methode:"cash", montant:0 }, { methode:"ancv", montant:0 }]);
                          }}>
                            💳 Encaisser le solde
                          </Btn>
                          <StripeButton bk={bk} dateLabel={todayLabel} dateId={todayEntry.id} boatId={boat.id} small />
                          {otherBoat && (
                            <button onClick={() => moveBooking(bk, boat, otherBoat, todayEntry)}
                              style={{ background:"#EBF7FA", border:`1px solid ${TEAL}40`, borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:11, color:TEAL, fontWeight:600 }}>
                              → {otherBoat.name==="Aloes Vera"?"Aloès":"Panamax"}
                            </button>
                          )}
                        </Row>
                      )}

                      {/* Payment form */}
                      {isPaying && (
                        <div style={{ background:"#F0F8FB", borderRadius:10, padding:14, marginTop:10, border:`1px solid ${TEAL}30` }}>
                          <div style={{ fontWeight:700, color:TEAL, fontSize:13, marginBottom:12 }}>
                            Encaissement solde — {bk.name} (reste : {fmtEur(reste)})
                          </div>
                          {PAY_METHODS.map(m => (
                            <Row key={m.id} gap={8} style={{ marginBottom:8, alignItems:"center", flexWrap:"nowrap" }}>
                              <span style={{ background:m.color, color:"#fff", fontSize:11, padding:"3px 10px", borderRadius:8, fontWeight:700, minWidth:80, textAlign:"center" }}>{m.icon} {m.label}</span>
                              <input type="number" min="0" value={payForm.find(p=>p.methode===m.id)?.montant||0}
                                onChange={e => setPayForm(f => f.map(p => p.methode===m.id ? {...p, montant:Math.max(0,+e.target.value)} : p))}
                                style={{ ...inputStyle, width:100, flex:1 }} placeholder="0" />
                              <span style={{ fontSize:12, color:"#888" }}>€</span>
                            </Row>
                          ))}
                          <div style={{ fontSize:12, color:"#888", marginBottom:12 }}>
                            Total saisi : <strong style={{ color: payForm.reduce((s,p)=>s+p.montant,0) === reste ? GREEN : CORAL }}>{fmtEur(payForm.reduce((s,p)=>s+p.montant,0))}</strong>
                            {" "}/ {fmtEur(reste)}
                          </div>
                          <Row gap={8}>
                            <Btn variant="success" onClick={savePayment} disabled={payForm.reduce((s,p)=>s+p.montant,0)===0}>✓ Valider</Btn>
                            <Btn variant="ghost" onClick={() => { setSelBk(null); setPayForm([]); }}>Annuler</Btn>
                          </Row>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  // ── PLANNING TAB ───────────────────────────────────────────
  const PlanningTab = () => {
    const today = new Date();
    const [curMonth, setCurMonth] = useState(today.getMonth());
    const [curYear,  setCurYear]  = useState(today.getFullYear());
    const prevMonth = () => { if(curMonth===0){setCurYear(y=>y-1);setCurMonth(11);}else setCurMonth(m=>m-1); };
    const nextMonth = () => { if(curMonth===11){setCurYear(y=>y+1);setCurMonth(0);}else setCurMonth(m=>m+1); };

    const firstDay = new Date(curYear, curMonth, 1);
    const lastDay  = new Date(curYear, curMonth+1, 0);
    let startDow = firstDay.getDay(); startDow = startDow===0?6:startDow-1;
    const cells = Array(startDow).fill(null);
    for(let d=1;d<=lastDay.getDate();d++) cells.push(new Date(curYear,curMonth,d));

    const planning = skData?.planning || {};
    const allSkippers = skData?.skippers || [];

    return (
      <div>
        <Row style={{ justifyContent:"space-between", marginBottom:16 }}>
          <button onClick={prevMonth} style={{ background:"#EBF7FA", border:"none", color:TEAL, width:38, height:38, borderRadius:19, cursor:"pointer", fontSize:18, fontWeight:700 }}>‹</button>
          <span style={{ fontSize:18, fontWeight:800, color:TEAL }}>{MONTHS[curMonth]} {curYear}</span>
          <button onClick={nextMonth} style={{ background:"#EBF7FA", border:"none", color:TEAL, width:38, height:38, borderRadius:19, cursor:"pointer", fontSize:18, fontWeight:700 }}>›</button>
        </Row>

        {/* Legend */}
        <Row gap={10} style={{ marginBottom:12, flexWrap:"wrap" }}>
          {allSkippers.map(s => (
            <Row key={s.id} gap={5} style={{ fontSize:12, color:"#555" }}>
              <div style={{ width:10, height:10, borderRadius:5, background:s.color, flexShrink:0 }}/>
              {s.name}
            </Row>
          ))}
          <Row gap={5} style={{ fontSize:12, color:"#aaa" }}>
            <div style={{ width:10, height:10, borderRadius:5, background:"#ddd" }}/> Non assigné
          </Row>
        </Row>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:3, marginBottom:3 }}>
          {DAYS_SHORT.map(d => <div key={d} style={{ textAlign:"center", fontSize:10, fontWeight:700, color:"#888" }}>{d}</div>)}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:3 }}>
          {cells.map((cell, i) => {
            if (!cell) return <div key={"e"+i}/>;
            const label  = labelFromDate(cell);
            const assign = planning[label] || {};
            const isToday = cell.toDateString() === today.toDateString();
            const aloesSk  = allSkippers.find(s=>s.id===assign.aloes);
            const panaSkk  = allSkippers.find(s=>s.id===assign.panamax);
            const isMine   = assign.aloes===skipperUser.id || assign.panamax===skipperUser.id;

            return (
              <div key={cell.toISOString()} style={{
                background: isToday ? TEAL : isMine ? `${skipperUser.color}15` : "#fff",
                border: isToday ? `2px solid ${TEAL}` : isMine ? `1.5px solid ${skipperUser.color}50` : "1px solid #eee",
                borderRadius:8, padding:"4px 3px", minHeight:56, display:"flex", flexDirection:"column", alignItems:"center", gap:2
              }}>
                <span style={{ fontSize:11, fontWeight:isToday?800:500, color:isToday?"#fff":isMine?skipperUser.color:DARK }}>{cell.getDate()}</span>
                {aloesSk && <div style={{ fontSize:7, background:aloesSk.color, color:"#fff", borderRadius:4, padding:"1px 4px", fontWeight:700, width:"100%", textAlign:"center" }}>🛥 {aloesSk.name}</div>}
                {panaSkk  && <div style={{ fontSize:7, background:panaSkk.color, color:"#fff", borderRadius:4, padding:"1px 4px", fontWeight:700, width:"100%", textAlign:"center" }}>🚤 {panaSkk.name}</div>}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop:16, background:"#F0F8FB", borderRadius:12, padding:"12px 16px", border:`1px solid ${TEAL}20` }}>
          <div style={{ fontWeight:700, color:TEAL, fontSize:13, marginBottom:8 }}>Mes prochaines sorties</div>
          {myPlanningDates.filter(label => {
            const d = dateFromLabel(label);
            return d && d >= new Date(today.getFullYear(),today.getMonth(),today.getDate());
          }).slice(0,5).map((label,i) => {
            const assign = planning[label] || {};
            const onAloes = assign.aloes === skipperUser.id;
            const onPana  = assign.panamax === skipperUser.id;
            return (
              <Row key={i} style={{ padding:"6px 0", borderBottom:"1px solid #e8f2f7", gap:10 }}>
                <span style={{ fontWeight:600, color:DARK, fontSize:13, flex:1 }}>{label}</span>
                {onAloes && <span style={{ fontSize:11, background:"#EBF7FA", color:TEAL, padding:"2px 8px", borderRadius:6, fontWeight:600 }}>🛥️ Aloès Vera</span>}
                {onPana  && <span style={{ fontSize:11, background:"#EBF7FA", color:TEAL, padding:"2px 8px", borderRadius:6, fontWeight:600 }}>🚤 Panamax</span>}
              </Row>
            );
          })}
          {myPlanningDates.filter(label => {
            const d = dateFromLabel(label);
            return d && d >= new Date(today.getFullYear(),today.getMonth(),today.getDate());
          }).length === 0 && <div style={{ color:"#bbb", fontSize:13 }}>Aucune sortie à venir planifiée.</div>}
        </div>
      </div>
    );
  };

  // ── EXCHANGE TAB ───────────────────────────────────────────
  const ExchangeTab = () => {
    const planning  = skData?.planning || {};
    const allSkippers = skData?.skippers || [];
    const otherSkipper = allSkippers.find(s => s.id !== skipperUser.id);
    const [mySlot,    setMySlot]    = useState(null); // { label, boatKey }
    const [theirSlot, setTheirSlot] = useState(null);

    // My upcoming slots
    const mySlots = Object.entries(planning)
      .filter(([label, assign]) => assign?.aloes===skipperUser.id || assign?.panamax===skipperUser.id)
      .flatMap(([label, assign]) => {
        const slots = [];
        if (assign.aloes===skipperUser.id)   slots.push({ label, boatKey:"aloes",   boatName:"Aloès Vera", icon:"🛥️" });
        if (assign.panamax===skipperUser.id) slots.push({ label, boatKey:"panamax", boatName:"Panamax",    icon:"🚤" });
        return slots;
      })
      .filter(s => { const d=dateFromLabel(s.label); return d && d >= new Date(); })
      .sort((a,b) => (dateFromLabel(a.label)||new Date(0))-(dateFromLabel(b.label)||new Date(0)));

    // Other skipper's upcoming slots
    const theirSlots = otherSkipper ? Object.entries(planning)
      .filter(([label, assign]) => assign?.aloes===otherSkipper.id || assign?.panamax===otherSkipper.id)
      .flatMap(([label, assign]) => {
        const slots = [];
        if (assign.aloes===otherSkipper.id)   slots.push({ label, boatKey:"aloes",   boatName:"Aloès Vera", icon:"🛥️" });
        if (assign.panamax===otherSkipper.id) slots.push({ label, boatKey:"panamax", boatName:"Panamax",    icon:"🚤" });
        return slots;
      })
      .filter(s => { const d=dateFromLabel(s.label); return d && d >= new Date(); })
      .sort((a,b) => (dateFromLabel(a.label)||new Date(0))-(dateFromLabel(b.label)||new Date(0)))
      : [];

    const SlotBtn = ({slot, selected, onSelect, color}) => (
      <button onClick={()=>onSelect(slot)}
        style={{ width:"100%", textAlign:"left", padding:"10px 14px", borderRadius:10, border:`2px solid ${selected?color:"#ddd"}`, background:selected?`${color}15`:"#fff", cursor:"pointer", marginBottom:6 }}>
        <Row>
          <span style={{ fontSize:14 }}>{slot.icon}</span>
          <div style={{ marginLeft:8, flex:1 }}>
            <div style={{ fontWeight:700, color:DARK, fontSize:13 }}>{slot.label}</div>
            <div style={{ fontSize:11, color:"#888" }}>{slot.boatName}</div>
          </div>
          {selected && <span style={{ fontSize:16, color }}>✓</span>}
        </Row>
      </button>
    );

    return (
      <div>
        <div style={{ background:"#FFF8EE", borderRadius:12, padding:"12px 16px", marginBottom:16, border:`1px solid ${ORANGE}30`, fontSize:13, color:"#666", lineHeight:1.6 }}>
          💡 Sélectionnez un de vos créneaux et un créneau de {otherSkipper?.name||"l'autre skipper"} pour les échanger. L'échange est <strong>immédiat et définitif</strong>.
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12 }}>
          <div>
            <div style={{ fontWeight:700, color:skipperUser.color, fontSize:13, marginBottom:8 }}>
              <div style={{ width:10, height:10, borderRadius:5, background:skipperUser.color, display:"inline-block", marginRight:6 }}/>
              Mes créneaux
            </div>
            {mySlots.length===0 && <div style={{ color:"#bbb", fontSize:12 }}>Aucun créneau à venir</div>}
            {mySlots.map((slot,i) => <SlotBtn key={i} slot={slot} selected={mySlot?.label===slot.label&&mySlot?.boatKey===slot.boatKey} onSelect={setMySlot} color={skipperUser.color} />)}
          </div>
          <div>
            <div style={{ fontWeight:700, color:otherSkipper?.color||"#888", fontSize:13, marginBottom:8 }}>
              <div style={{ width:10, height:10, borderRadius:5, background:otherSkipper?.color||"#888", display:"inline-block", marginRight:6 }}/>
              Créneaux de {otherSkipper?.name||"—"}
            </div>
            {theirSlots.length===0 && <div style={{ color:"#bbb", fontSize:12 }}>Aucun créneau disponible</div>}
            {theirSlots.map((slot,i) => <SlotBtn key={i} slot={slot} selected={theirSlot?.label===slot.label&&theirSlot?.boatKey===slot.boatKey} onSelect={setTheirSlot} color={otherSkipper?.color||"#888"} />)}
          </div>
        </div>

        {mySlot && theirSlot && (
          <div style={{ background:"#F0F8FB", borderRadius:12, padding:16, marginTop:16, border:`1px solid ${TEAL}30` }}>
            <div style={{ fontWeight:700, color:TEAL, marginBottom:12 }}>Confirmer l'échange</div>
            <Row style={{ gap:10, marginBottom:14, flexWrap:"wrap", justifyContent:"center" }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#aaa", marginBottom:4 }}>Mon créneau</div>
                <div style={{ fontWeight:700, color:skipperUser.color }}>{mySlot.icon} {mySlot.label}</div>
                <div style={{ fontSize:11, color:"#888" }}>{mySlot.boatName}</div>
              </div>
              <span style={{ fontSize:24, color:"#ccc" }}>⇄</span>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:11, color:"#aaa", marginBottom:4 }}>Créneau de {otherSkipper?.name}</div>
                <div style={{ fontWeight:700, color:otherSkipper?.color }}>{theirSlot.icon} {theirSlot.label}</div>
                <div style={{ fontSize:11, color:"#888" }}>{theirSlot.boatName}</div>
              </div>
            </Row>
            <Btn full variant="success" onClick={() => doExchange(mySlot.label, mySlot.boatKey, theirSlot.label, theirSlot.boatKey)} style={{ padding:12 }}>
              ✓ Confirmer l'échange
            </Btn>
          </div>
        )}
      </div>
    );
  };

  // ── MAIN RENDER ────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#EBF7FA", fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${DARK},${TEAL})`, color:"#fff", padding:"0 16px", height:56, display:"flex", alignItems:"center", gap:10, position:"sticky", top:0, zIndex:100 }}>
        <span style={{ fontSize:22 }}>⚓</span>
        <div>
          <div style={{ fontSize:15, fontWeight:700 }}>Skipper</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)" }}>{skipperUser.name}</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:2, overflowX:"auto", WebkitOverflowScrolling:"touch", flexShrink:1 }}>
          {[["today","📅"],["all","📋"],["planning","🗓️"],["exchange","🔄"]].map(([v,lbl])=>(
            <button key={v} onClick={()=>setTab(v)}
              style={{ background:tab===v?"rgba(255,255,255,0.2)":"transparent", color:tab===v?"#fff":"rgba(255,255,255,0.55)", border:"none", borderRadius:16, padding:"5px 10px", cursor:"pointer", fontSize:13, fontWeight:tab===v?700:400, whiteSpace:"nowrap" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:700, margin:"0 auto", padding:"14px 14px 80px" }}>
        {tab === "today"    && <TodayTab />}
        {tab === "all"      && <AllDatesTab />}
        {tab === "planning" && <PlanningTab />}
        {tab === "exchange" && <ExchangeTab />}
      </div>

      {notif && <div style={{ position:"fixed", bottom:22, left:"50%", transform:"translateX(-50%)", background:notif.ok?TEAL:CORAL, color:"#fff", padding:"10px 24px", borderRadius:28, fontSize:14, fontWeight:600, zIndex:9999, whiteSpace:"nowrap" }}>{notif.msg}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// PIN GATE
// ════════════════════════════════════════════════════════════════
function PinGate({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const check = () => { if (pin === PIN) { onUnlock(); } else { setErr(true); setPin(""); setTimeout(() => setErr(false), 1500); } };
  return (
    <div style={{ minHeight: "100vh", background: DARK, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 40, textAlign: "center", maxWidth: 320, width: "100%" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🐟</div>
        <h2 style={{ color: TEAL, margin: "0 0 6px" }}>Panamax Admin</h2>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 24 }}>Accès réservé à l'équipe Panamax</p>
        <input type="password" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === "Enter" && check()}
          placeholder="Code PIN"
          style={{ width: "100%", padding: "12px 14px", border: `2px solid ${err ? CORAL : "#ddd"}`, borderRadius: 10, fontSize: 18, textAlign: "center", boxSizing: "border-box", letterSpacing: 8, marginBottom: 12 }} />
        {err && <p style={{ color: CORAL, fontSize: 13, margin: "0 0 10px" }}>Code incorrect</p>}
        <Btn full onClick={check} style={{ padding: 12, fontSize: 15 }}>Accéder →</Btn>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// STRIPE PAYMENT BUTTON
// ════════════════════════════════════════════════════════════════
function StripeButton({ bk, dateLabel, dateId, boatId, small }) {
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  const reste = Math.max(0, bk.price - (bk.acompte_amount||0) - (bk.solde_encaisse||0));
  if (reste <= 0) return null;

  const handleStripe = async () => {
    setLoading(true);
    const url = await generateStripeLink({
      amount:      reste,
      clientName:  bk.name,
      clientEmail: bk.email || '',
      dateLabel,
      bookingId:   bk.id,
      dateId,
      boatId,
    });
    setLoading(false);
    if (!url) { alert('Erreur lors de la génération du lien Stripe'); return; }

    // Ouvrir le menu de choix
    const choice = window.confirm(
      `Lien de paiement généré pour ${bk.name} (${fmtEur(reste)})\n\nCliquez OK pour copier le lien et l'envoyer par WhatsApp\nCliquez Annuler pour ouvrir le lien directement`
    );
    if (choice) {
      // Copier + WhatsApp
      navigator.clipboard?.writeText(url).catch(() => {});
      const msg = encodeURIComponent(`Bonjour ${bk.name},\n\nVoici le lien pour régler le solde de votre excursion Panamax (${fmtEur(reste)}) :\n${url}\n\nÀ très bientôt sur l'eau ! 🌊`);
      const tel = fullPhone(bk);
      const waNum = tel ? tel.replace(/[^0-9]/g,'') : '';
      if (waNum) window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
      else { window.open(`https://wa.me?text=${msg}`, '_blank'); }
      setCopied(true); setTimeout(()=>setCopied(false), 3000);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <button onClick={handleStripe} disabled={loading}
      style={{
        background: loading ? "#ccc" : "#635BFF",
        color: "#fff", border: "none",
        borderRadius: 6,
        padding: small ? "5px 10px" : "7px 14px",
        cursor: loading ? "not-allowed" : "pointer",
        fontSize: small ? 11 : 12,
        fontWeight: 700,
        display: "flex", alignItems: "center", gap: 4,
        flexShrink: 0,
        opacity: loading ? 0.7 : 1,
      }}>
      {loading ? "⏳" : copied ? "✓ Lien copié !" : "💳 Lien paiement"}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════
// ROOT
// ════════════════════════════════════════════════════════════════
export default function Root() {
  const { data, save, sources, saveSources, skData, saveSkData, loading, reload } = useData();
  const [mode, setMode] = useState("reseller");
  const [skipperUser, setSkipperUser] = useState(null); // logged-in skipper

  if (loading) return (
    <div style={{ minHeight: "100vh", background: DARK, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "system-ui", gap: 16 }}>
      <div style={{ fontSize: 48 }}>🐟</div>
      <div style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>Chargement…</div>
    </div>
  );

  return (
    <div>
      {mode === "reseller" && (
        <div style={{ minHeight: "100vh", width: "100%", overflowX: "hidden", boxSizing: "border-box", background: `linear-gradient(160deg, ${DARK} 0%, ${TEAL} 55%, #2E86AB 100%)`, fontFamily: "'Segoe UI', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "24px 24px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <img src="/1-ICONE-POISSON-PANAMAX-Original.png" alt="Panamax" style={{ width: 72, height: 72, objectFit: "contain", marginBottom: 6 }} />
            <div style={{ color: "#fff", fontSize: 21, fontWeight: 800 }}>Panamax Excursions</div>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 3 }}>Portail Commercial · Réservations en ligne</div>
          </div>
          <ResellerPortal data={data} save={save} />
        </div>
      )}
      {mode === "admin-gate" && <PinGate onUnlock={() => setMode("admin")} />}
      {mode === "admin"      && <AdminView data={data} save={save} sources={sources} saveSources={saveSources} skData={skData} saveSkData={saveSkData} reload={reload} />}

      {/* Skipper gate */}
      {mode === "skipper-gate" && (
        <SkipperGate skData={skData} onLogin={(sk) => { setSkipperUser(sk); setMode("skipper"); }} onCancel={() => setMode("reseller")} />
      )}
      {/* Skipper view */}
      {mode === "skipper" && skipperUser && (
        <SkipperView data={data} save={save} skData={skData} saveSkData={saveSkData} skipperUser={skipperUser} onLogout={() => { setSkipperUser(null); setMode("reseller"); }} />
      )}

      {/* Nav buttons */}
      <div style={{ position: "fixed", bottom: 16, right: 14, zIndex: 200, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        {mode === "reseller" && (
          <button onClick={() => setMode("skipper-gate")}
            style={{ background: "rgba(0,0,0,0.25)", border: "none", cursor: "pointer", fontSize: 13, opacity: 0.35, padding: "5px 12px", borderRadius: 20, color: "#fff", fontWeight: 600 }}>
            ⚓
          </button>
        )}
        {mode === "skipper" && (
          <button onClick={() => { setSkipperUser(null); setMode("reseller"); }}
            style={{ background: "rgba(13,61,82,0.85)", border: "none", cursor: "pointer", fontSize: 12, padding: "6px 14px", borderRadius: 20, color: "#fff", fontWeight: 700 }}>
            ← Portail
          </button>
        )}
        <button onClick={() => mode === "admin" ? setMode("reseller") : setMode("admin-gate")}
          style={{ background: mode === "admin" ? "rgba(13,61,82,0.85)" : "none", border: "none", cursor: "pointer", fontSize: mode === "admin" ? 13 : 16, opacity: mode === "admin" ? 0.9 : 0.2, padding: mode === "admin" ? "6px 12px" : 4, lineHeight: 1, borderRadius: 20, color: "#fff", fontWeight: 600 }}>
          {mode === "admin" ? "← Portail" : "🐟"}
        </button>
      </div>
    </div>
  );
}
