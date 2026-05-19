import { useState, useEffect, useCallback } from "react";

// ── Constants ──────────────────────────────────────────────────
const MAX_CAP   = 12;
const P_AD      = 115;
const P_CH      = 95;
const PIN       = "1234";
const STORE_KEY = "panamax-v3";
const TEAL      = "#1A5F7A";
const CORAL     = "#E8673A";
const DARK      = "#0D3D52";
const GREEN     = "#1E8449";
const ORANGE    = "#E67E22";

const DAYS_SHORT = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const DAYS_LONG  = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const MONTHS     = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

const SOURCES = {
  luc:   { label:"Luc",   color:"#1A5F7A" },
  lud:   { label:"Lud",   color:"#2471A3" },
  cdi:   { label:"CDI",   color:"#C0392B" },
  cam:   { label:"Cam",   color:"#1E8449" },
  ici:   { label:"Ici",   color:"#7D3C98" },
  woo:   { label:"Web",   color:"#8E44AD" },
  autre: { label:"Autre", color:"#7F8C8D" },
};

// ── Utils ──────────────────────────────────────────────────────
const uid      = () => Math.random().toString(36).slice(2, 9);
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
function useData() {
  const [data,    setData]    = useState({ dates: [], pending: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await window.storage.get(STORE_KEY, true);
      if (r) setData(JSON.parse(r.value));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 9000); return () => clearInterval(t); }, [load]);

  const save = async (next) => {
    setData(next);
    try { await window.storage.set(STORE_KEY, JSON.stringify(next), true); } catch {}
  };

  return { data, save, loading, reload: load };
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
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff" };

const FInput  = ({ label, ...p }) => <div><Label>{label}</Label><input  style={inputStyle} {...p} /></div>;
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
const BLANK = { adults: 2, children: 0, name: "", source: "luc", phone: "", price: P_AD * 2, notes: "" };

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
      // Create the real date entry
      const newEntry = makeDateEntry(selDate.label);
      // find matching boat by name
      const targetBoat = newEntry.boats.find(b => b.name === selBoat.name);
      dateId   = newEntry.id;
      boatId   = targetBoat ? targetBoat.id : newEntry.boats[0].id;
      nextData = { ...data, dates: [...data.dates, newEntry] };
    }

    const pending = {
      ...form,
      id: uid(), dateId, boatId,
      price: form.adults * P_AD + form.children * P_CH,
      status: "pending",
      ts: Date.now(),
    };
    save({ ...nextData, pending: [...(nextData.pending || []), pending] });
    setStep("ok");
  };

  // ── Success screen ─────────────────────────
  if (step === "ok") return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: 40, textAlign: "center", maxWidth: 420, width: "100%" }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>✅</div>
        <h2 style={{ color: TEAL, margin: "0 0 8px" }}>Demande envoyée !</h2>
        <p style={{ color: "#666", lineHeight: 1.7, marginBottom: 24 }}>Votre réservation est en attente de validation par l'équipe Panamax.</p>
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
          <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 14 }}>
            <FInput label={`Adultes — ${P_AD}€/pers.`} type="number" min="0" value={form.adults}
              onChange={e => { const v = Math.max(0, +e.target.value); setForm(f => ({ ...f, adults: v, price: v * P_AD + f.children * P_CH })); }} />
            <FInput label={`Enfants — ${P_CH}€/pers.`} type="number" min="0" value={form.children}
              onChange={e => { const v = Math.max(0, +e.target.value); setForm(f => ({ ...f, children: v, price: f.adults * P_AD + v * P_CH })); }} />
          </Grid>
          <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 14 }}>
            <FSelect label="Canal de vente" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
              {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </FSelect>
            <FInput label="Téléphone client" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+33..." />
          </Grid>
          <div style={{ marginBottom: 14 }}>
            <FInput label="Nom du client" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom, prénom..." />
          </div>
          <div style={{ marginBottom: 22 }}>
            <Label>Notes (optionnel)</Label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="🎂 Anniversaire, ♿ handicap, remise, demande spéciale..."
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
            />
          </div>
          <div style={{ background: "#EBF7FA", borderRadius: 12, padding: "14px 18px", marginBottom: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "#6aadcc", fontWeight: 600 }}>TOTAL ESTIMÉ</div>
              <div style={{ fontSize: 11, color: "#7abfd4", marginTop: 2 }}>{form.adults} ad.×{P_AD}€{form.children ? ` + ${form.children} enf.×${P_CH}€` : ""}</div>
            </div>
            <span style={{ fontSize: 28, fontWeight: 800, color: TEAL }}>{fmtEur(form.adults * P_AD + form.children * P_CH)}</span>
          </div>
          <Btn full onClick={submit} disabled={!form.name.trim() || form.adults + form.children === 0} style={{ padding: 15, fontSize: 16 }}>
            Envoyer la demande →
          </Btn>
          <p style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 10, lineHeight: 1.6 }}>
            Demande validée par Panamax sous 24h.
          </p>
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
    const pending = (data.pending || []).filter(p => p.source === identity);
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
            const dateEntry = data.dates.find(d => d.id === p.dateId);
            const boat = dateEntry?.boats.find(b => b.id === p.boatId);
            const icon = boat?.name === "Aloes Vera" ? "🛥️" : "🚤";
            const bname = boat?.name === "Aloes Vera" ? "Aloès Vera" : boat?.name || "Bateau";
            const isPendingDel = delPending === p.id;
            return (
              <div key={p.id} style={{ border: "1px solid #e0eef3", borderRadius: 14, padding: 16, marginBottom: 12 }}>
                <Row style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: TEAL, fontSize: 14 }}>📅 {dateEntry?.label || "Date inconnue"}</div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{icon} {bname}</div>
                  </div>
                  <span style={{ marginLeft: "auto", background: "#FFF8EE", color: ORANGE, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 8, alignSelf: "flex-start" }}>⏳ En attente</span>
                </Row>
                <div style={{ fontSize: 13, color: "#444", lineHeight: 1.9, marginBottom: 12 }}>
                  <div>👤 <strong>{p.name}</strong></div>
                  <div>👥 {p.children ? `${p.adults} adulte(s) + ${p.children} enfant(s)` : `${p.adults} adulte(s)`}</div>
                  {p.phone && <div>📞 {p.phone}</div>}
                  {p.notes && <div>📝 {p.notes}</div>}
                  <div style={{ color: TEAL, fontWeight: 700 }}>💰 {fmtEur(p.adults * P_AD + p.children * P_CH)}</div>
                </div>
                {isPendingDel ? (
                  <Row gap={8}>
                    <Btn small variant="danger" onClick={() => { save({ ...data, pending: data.pending.filter(x => x.id !== p.id) }); setDelPending(null); }}>Confirmer l'annulation</Btn>
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
      save({ ...data, pending: data.pending.map(p => p.id === editingPending.id ? updated : p) });
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
          <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 14 }}>
            <FInput label={`Adultes — ${P_AD}€/pers.`} type="number" min="0" value={editForm.adults}
              onChange={e => { const v = Math.max(0, +e.target.value); setEditForm(f => ({ ...f, adults: v, price: v * P_AD + f.children * P_CH })); }} />
            <FInput label={`Enfants — ${P_CH}€/pers.`} type="number" min="0" value={editForm.children}
              onChange={e => { const v = Math.max(0, +e.target.value); setEditForm(f => ({ ...f, children: v, price: f.adults * P_AD + v * P_CH })); }} />
          </Grid>
          <Grid cols="1fr 1fr" gap={12} style={{ marginBottom: 14 }}>
            <FSelect label="Canal de vente" value={editForm.source} onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}>
              {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </FSelect>
            <FInput label="Téléphone client" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="+33..." />
          </Grid>
          <div style={{ marginBottom: 14 }}>
            <FInput label="Nom du client" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom, prénom..." />
          </div>
          <div style={{ marginBottom: 22 }}>
            <Label>Notes (optionnel)</Label>
            <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="🎂 Anniversaire, ♿ handicap, remise..." 
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff", resize: "vertical", minHeight: 72, fontFamily: "inherit" }} />
          </div>
          <div style={{ background: "#EBF7FA", borderRadius: 12, padding: "14px 18px", marginBottom: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "#6aadcc", fontWeight: 600 }}>TOTAL ESTIMÉ</div>
              <div style={{ fontSize: 11, color: "#7abfd4", marginTop: 2 }}>{editForm.adults} ad.×{P_AD}€{editForm.children ? ` + ${editForm.children} enf.×${P_CH}€` : ""}</div>
            </div>
            <span style={{ fontSize: 28, fontWeight: 800, color: TEAL }}>{fmtEur(editForm.adults * P_AD + editForm.children * P_CH)}</span>
          </div>
          <Btn full onClick={saveEdit} disabled={!editForm.name.trim() || editForm.adults + editForm.children === 0} style={{ padding: 15, fontSize: 16 }}>
            Enregistrer les modifications →
          </Btn>
        </div>
      </div>
    );
  }

  // ── Main calendar ──────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 14px 40px", maxWidth: 700, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Top bar: mes réservations */}
      <Row style={{ justifyContent: "flex-end", padding: "12px 4px 0" }}>
        <button onClick={() => setStep("mes-resa")}
          style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 20, padding: "6px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          📋 Mes réservations
          {(data.pending||[]).length > 0 && <span style={{ background: CORAL, borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 7px" }}>{(data.pending||[]).length}</span>}
        </button>
      </Row>

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
        {DAYS_SHORT.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", padding: "4px 0" }}>{d}</div>)}
      </div>

      {/* Calendar cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
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
                minHeight: 76,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                opacity: isPast ? 0.35 : 1,
              }}>
              <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 500, color: "#fff" }}>{cell.getDate()}</span>

              {/* Both boats, every day */}
              <div style={{ width: "calc(100% - 4px)", display: "flex", flexDirection: "column", gap: 3 }}>
                {entry.boats.map(boat => {
                  const r  = spots(boat);
                  const p  = pct(boat);
                  const bc = barColor(boat);
                  const icon = boat.name === "Aloes Vera" ? "🛥️" : "🚤";
                  return (
                    <div key={boat.id} style={{ background: "rgba(255,255,255,0.13)", borderRadius: 5, padding: "3px 5px" }}>
                      <Row style={{ justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.7)" }}>{boat.name === "Aloes Vera" ? "Aloès" : "Panamax"}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: r <= 0 ? CORAL : "#FA9F6A" }}>{r <= 0 ? "🚫" : `${r}p`}</span>
                      </Row>
                      <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
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
          Tarifs : {P_AD}€/adulte · {P_CH}€/enfant. Validation par Panamax sous 24h.
        </div>
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

      const adults   = parseInt(meta(order, "Nombre Adultes") || meta(order, "nombre_adultes") || meta(order, "_billing_adults") || "1", 10);
      const children = parseInt(meta(order, "Enfant de -12 ans") || meta(order, "enfant_de_-12_ans") || meta(order, "enfants") || "0", 10);
      const date1str = meta(order, "Date privilégiée") || meta(order, "date_privilegiee") || meta(order, "_preferred_date");
      const date2str = meta(order, "Seconde date possible") || meta(order, "seconde_date") || meta(order, "_second_date");
      const infoComp = meta(order, "Informations complémentaires") || meta(order, "informations_complementaires") || meta(order, "message") || "";
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
      const creds = btoa(`${ck}:${cs}`);
      const url = `${siteUrl.replace(/\/$/, "")}/wp-json/wc/v3/orders?per_page=50&status=completed,processing&orderby=date&order=desc`;
      const res = await fetch(url, { headers: { Authorization: `Basic ${creds}` } });
      if (!res.ok) throw new Error(`Erreur ${res.status} — vérifiez les clés API`);
      const raw = await res.json();
      setOrders(raw);
      setPreview(mapOrders(raw));
    } catch (e) {
      setError(e.message || "Erreur de connexion. Vérifiez l'URL et les clés API.");
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
        <div style={{ background: "#F8FBFC", borderRadius: 12, padding: 18, marginBottom: 20, border: "1px solid #e0eef3" }}>
          <div style={{ fontWeight: 700, color: DARK, fontSize: 13, marginBottom: 14 }}>🔑 Clés API WooCommerce</div>
          <Grid cols="1fr" gap={10} style={{ marginBottom: 10 }}>
            <FInput label="URL du site" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://panamaxexcursions.com" />
          </Grid>
          <Grid cols="1fr 1fr" gap={10}>
            <FInput label="Consumer Key (ck_...)" value={ck} onChange={e => setCk(e.target.value)} placeholder="ck_xxxxxxxxxxxx" />
            <FInput label="Consumer Secret (cs_...)" value={cs} onChange={e => setCs(e.target.value)} placeholder="cs_xxxxxxxxxxxx" type="password" />
          </Grid>
          <p style={{ fontSize: 11, color: "#aaa", marginTop: 10, lineHeight: 1.6 }}>
            WooCommerce → Réglages → Avancé → API REST → Créer une clé (lecture seule)
          </p>
          <div style={{ background: "#FFF8EE", border: `1px solid ${ORANGE}40`, borderRadius: 8, padding: "10px 14px", marginTop: 12, fontSize: 12, color: ORANGE, lineHeight: 1.6 }}>
            ⚠️ <strong>Note :</strong> L'appel API direct fonctionne uniquement sur le site déployé (Vercel). Dans cet outil de prévisualisation, utilisez le mode <strong>Coller le JSON</strong>.
          </div>
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
        {mode === "api"  && <Btn onClick={fetchOrders} disabled={loading || !ck || !cs}>{loading ? "Chargement…" : "🔄 Récupérer les commandes"}</Btn>}
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
// ADMIN VIEW
// ════════════════════════════════════════════════════════════════
function AdminView({ data, save, reload }) {
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
  const pc   = (data.pending || []).length;

  return (
    <div style={{ minHeight: "100vh", background: "#EBF7FA", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: DARK, color: "#fff", padding: "0 20px", height: 56, display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100 }}>
        <span style={{ fontSize: 22 }}>🐟</span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>Panamax · Admin</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[["planning", "📅 Planning"], ["pending", `⏳ Attente${pc ? ` (${pc})` : ""}`], ["woo", "🛒 WooCommerce"], ["import", "⬆️ Importer"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setTab(v)} style={{ background: tab === v ? "rgba(255,255,255,0.15)" : "transparent", color: tab === v ? "#fff" : "rgba(255,255,255,0.55)", border: "none", borderRadius: 20, padding: "5px 14px", cursor: "pointer", fontSize: 13, fontWeight: tab === v ? 700 : 400 }}>{lbl}</button>
          ))}
          <button onClick={reload} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, padding: "0 8px" }}>↻</button>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "16px 16px 60px" }}>

        {/* ── Planning tab ── */}
        {tab === "planning" && (<>
          <Grid cols="repeat(3,1fr)" gap={10} style={{ marginBottom: 18 }}>
            {[{ v: fmtEur(gRev), l: "Chiffre d'affaires", i: "💰" }, { v: gPax, l: "Passagers", i: "👥" }, { v: gBk, l: "Réservations", i: "📋" }].map(({ v, l, i }) => (
              <div key={l} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", textAlign: "center", border: "1px solid #e0eef3" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{i} {l}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: TEAL }}>{v}</div>
              </div>
            ))}
          </Grid>

          {data.dates.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>🚤</div>
              <p style={{ fontSize: 16, marginBottom: 20 }}>Aucune date — importez ou créez une date.</p>
              <Btn onClick={() => setTab("import")}>⬆️ Importer le planning WhatsApp</Btn>
            </div>
          )}

          {data.dates.map(entry => {
            const dp = entry.boats.reduce((s, b) => s + boatPax(b), 0);
            const dr = entry.boats.reduce((s, b) => s + boatRev(b), 0);
            const isOpen = exp[entry.id];
            return (
              <div key={entry.id} style={{ background: "#fff", borderRadius: 12, marginBottom: 10, overflow: "hidden", border: "1px solid #deeaf0" }}>
                <Row style={{ padding: "13px 16px", cursor: "pointer", userSelect: "none" }} onClick={() => toggle(entry.id)}>
                  <span>📅</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: TEAL, flex: 1 }}>{entry.label}</span>
                  <Chip bg="#EBF7FA" color={TEAL}>{dp} pax</Chip>
                  <Chip bg="#FEF0EB" color={CORAL}>{fmtEur(dr)}</Chip>
                  <button onClick={e => { e.stopPropagation(); copyWA(entry); }} style={{ background: copied === entry.id ? GREEN : "#fff", color: copied === entry.id ? "#fff" : "#555", border: "1px solid #ddd", borderRadius: 6, padding: "4px 11px", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                    {copied === entry.id ? "✓ Copié !" : "📋 WhatsApp"}
                  </button>
                  {delDate === entry.id
                    ? <Row gap={5} onClick={e => e.stopPropagation()}><Btn small variant="danger" onClick={() => doDelDate(entry.id)}>Supprimer</Btn><Btn small variant="ghost" onClick={() => setDelDate(null)}>✕</Btn></Row>
                    : <button onClick={e => { e.stopPropagation(); setDelDate(entry.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", fontSize: 16 }}>🗑</button>
                  }
                  <span style={{ color: "#bbb", fontSize: 11 }}>{isOpen ? "▲" : "▼"}</span>
                </Row>

                {isOpen && entry.boats.map(boat => {
                  const icon = boat.name === "Aloes Vera" ? "🛥️" : "🚤";
                  const displayName = boat.name === "Aloes Vera" ? "Aloès Vera" : boat.name;
                  const isAdding = adding?.dateId === entry.id && adding?.boatId === boat.id;
                  return (
                    <div key={boat.id} style={{ borderTop: "1px solid #f0f5f7", padding: "12px 16px 14px" }}>
                      <Row style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 18 }}>{icon}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: DARK, flex: 1 }}>{displayName}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>{fmtEur(boatRev(boat))}</span>
                      </Row>
                      <CapBar boat={boat} />
                      <div style={{ marginTop: 10 }}>
                        {boat.bookings.map(bk => {
                          const isEd = editing?.boatId === boat.id && editing?.bkId === bk.id;
                          if (isEd) return (
                            <BookingForm key={bk.id} title="✏️ Modifier" form={editing.form} set={f => setEditing(e => ({ ...e, form: f(e.form) }))} onSave={saveEdit} onCancel={() => setEditing(null)} admin />
                          );
                          return (
                            <div key={bk.id}>
                              <Row style={{ padding: "8px 0", borderBottom: "1px solid #f0f5f7", fontSize: 13 }}>
                                <span style={{ background: SOURCES[bk.source]?.color || "#999", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 8, fontWeight: 700, minWidth: 28, textAlign: "center", flexShrink: 0 }}>{SOURCES[bk.source]?.label || "?"}</span>
                                <span style={{ fontWeight: 700, color: DARK, minWidth: 34, flexShrink: 0 }}>{bk.children ? `${bk.adults}+${bk.children}` : bk.adults}</span>
                                <span style={{ flex: 1, color: DARK, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bk.name}</span>
                                {bk.phone && <span style={{ color: "#999", fontSize: 11, flexShrink: 0 }}>{bk.phone}</span>}
                                {bk.notes && <span style={{ fontSize: 12, flexShrink: 0 }}>{bk.notes}</span>}
                                <span style={{ fontWeight: 700, color: bk.price === 0 ? ORANGE : TEAL, minWidth: 44, textAlign: "right", flexShrink: 0 }}>{bk.price}€</span>
                                <button onClick={() => { setAdding(null); setEditing({ dateId: entry.id, boatId: boat.id, bkId: bk.id, form: { ...bk } }); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>✏️</button>
                                <button onClick={() => setDelBk(bk.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#ddd" }}>🗑</button>
                              </Row>
                              {delBk === bk.id && (
                                <Row gap={6} style={{ padding: "4px 0 8px", marginLeft: 44 }}>
                                  <Btn small variant="danger" onClick={() => doDelBk(entry.id, boat.id, bk.id)}>Confirmer</Btn>
                                  <Btn small variant="ghost" onClick={() => setDelBk(null)}>Annuler</Btn>
                                </Row>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {isAdding
                        ? <BookingForm title="+ Nouvelle réservation" form={adding.form} set={f => setAdding(a => ({ ...a, form: f(a.form) }))} onSave={saveAdd} onCancel={() => setAdding(null)} admin />
                        : <button onClick={() => { setEditing(null); setAdding({ dateId: entry.id, boatId: boat.id, form: { ...BLANK } }); }}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 7, background: "#EBF7FA", border: `1.5px dashed ${TEAL}70`, color: TEAL, cursor: "pointer", fontSize: 12, fontWeight: 600, marginTop: 10 }}>
                            + Ajouter une réservation
                          </button>
                      }
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div style={{ marginTop: 6 }}>
            {addDate
              ? <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: `1.5px dashed ${TEAL}60` }}>
                  <div style={{ fontWeight: 700, color: TEAL, marginBottom: 10 }}>+ Nouvelle date</div>
                  <FInput value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && saveNewDate()} placeholder="ex: Mercredi 29/05" />
                  <Row gap={8} style={{ marginTop: 10 }}><Btn onClick={saveNewDate}>Créer</Btn><Btn variant="ghost" onClick={() => { setAddDate(false); setNewLabel(""); }}>Annuler</Btn></Row>
                </div>
              : <button onClick={() => setAddDate(true)} style={{ width: "100%", padding: 12, borderRadius: 12, background: "transparent", border: `1.5px dashed ${TEAL}60`, color: TEAL, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>+ Nouvelle date</button>
            }
          </div>
        </>)}

        {/* ── Pending tab ── */}
        {tab === "pending" && (
          <div>
            <h2 style={{ color: TEAL, margin: "0 0 16px", fontSize: 20 }}>⏳ Demandes en attente</h2>
            {(data.pending || []).length === 0
              ? <div style={{ textAlign: "center", padding: "60px 20px", color: "#aaa" }}><div style={{ fontSize: 40, marginBottom: 10 }}>✅</div><p>Aucune demande en attente.</p></div>
              : (data.pending || []).map(p => {
                  const entry = data.dates.find(d => d.id === p.dateId);
                  const boat  = entry?.boats.find(b => b.id === p.boatId);
                  const icon  = boat?.name === "Aloes Vera" ? "🛥️" : "🚤";
                  const dname = boat?.name === "Aloes Vera" ? "Aloès Vera" : boat?.name;
                  return (
                    <div key={p.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", marginBottom: 10, border: "2px solid #F5CBA7" }}>
                      <Row gap={8} style={{ marginBottom: 10, fontSize: 13, color: "#888", flexWrap: "wrap" }}>
                        <span>📅 <strong style={{ color: DARK }}>{entry?.label || p.dateId}</strong></span>
                        <span>·</span>
                        <span>{icon} <strong style={{ color: DARK }}>{dname || p.boatId}</strong></span>
                        <span style={{ marginLeft: "auto", fontSize: 11 }}>{new Date(p.ts).toLocaleString("fr")}</span>
                      </Row>
                      <Row gap={8} style={{ fontSize: 13, flexWrap: "wrap" }}>
                        <span style={{ background: SOURCES[p.source]?.color || "#999", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 8, fontWeight: 700 }}>{SOURCES[p.source]?.label || "?"}</span>
                        <span style={{ fontWeight: 700 }}>{p.children ? `${p.adults}+${p.children}` : p.adults}</span>
                        <span style={{ flex: 1, fontWeight: 500 }}>{p.name}</span>
                        {p.phone && <span style={{ color: "#999", fontSize: 11 }}>{p.phone}</span>}
                        <span style={{ fontWeight: 700, color: TEAL }}>{fmtEur(p.adults * P_AD + p.children * P_CH)}</span>
                        <Btn small variant="success" onClick={() => approve(p)}>✓ Valider</Btn>
                        <Btn small variant="danger"  onClick={() => reject(p)}>✕ Refuser</Btn>
                      </Row>
                    </div>
                  );
                })
            }
          </div>
        )}

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
// ROOT
// ════════════════════════════════════════════════════════════════
export default function Root() {
  const { data, save, loading, reload } = useData();
  const [mode, setMode] = useState("reseller");

  if (loading) return (
    <div style={{ minHeight: "100vh", background: DARK, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "system-ui", gap: 16 }}>
      <div style={{ fontSize: 48 }}>🐟</div>
      <div style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>Chargement…</div>
    </div>
  );

  return (
    <div>
      {mode === "reseller" && (
        <div style={{ minHeight: "100vh", background: `linear-gradient(160deg, ${DARK} 0%, ${TEAL} 55%, #2E86AB 100%)`, fontFamily: "'Segoe UI', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "28px 24px 0", textAlign: "center" }}>
            <div style={{ color: "#fff", fontSize: 21, fontWeight: 800 }}>Panamax Excursions</div>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 4 }}>Portail Commercial · Réservations en ligne</div>
          </div>
          <ResellerPortal data={data} save={save} />
        </div>
      )}
      {mode === "admin-gate" && <PinGate onUnlock={() => setMode("admin")} />}
      {mode === "admin"      && <AdminView data={data} save={save} reload={reload} />}

      <div style={{ position: "fixed", bottom: 120, right: 14, zIndex: 200 }}>
        <button onClick={() => mode === "admin" ? setMode("reseller") : setMode("admin-gate")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, opacity: 0.25, padding: 4, lineHeight: 1 }}
          title="Admin">🐟</button>
      </div>
    </div>
  );
}
