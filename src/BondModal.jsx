// src/BondModal.jsx
// Obliczenia zgodne z oficjalnymi listami emisyjnymi Ministerstwa Finansów
import { useState } from "react";

// ─── Dane inflacji GUS (miesięczne, YoY) ─────────────────────────────────────
// Źródło: GUS, ogłaszane przez Prezesa GUS
const INFLACJA = {
  "2020-01":0.036,"2020-02":0.043,"2020-03":0.047,"2020-04":0.030,"2020-05":0.029,
  "2020-06":0.031,"2020-07":0.030,"2020-08":0.029,"2020-09":0.031,"2020-10":0.030,
  "2020-11":0.028,"2020-12":0.025,"2021-01":0.026,"2021-02":0.024,"2021-03":0.032,
  "2021-04":0.042,"2021-05":0.047,"2021-06":0.052,"2021-07":0.050,"2021-08":0.054,
  "2021-09":0.056,"2021-10":0.068,"2021-11":0.077,"2021-12":0.083,"2022-01":0.096,
  "2022-02":0.087,"2022-03":0.111,"2022-04":0.123,"2022-05":0.137,"2022-06":0.156,
  "2022-07":0.158,"2022-08":0.161,"2022-09":0.172,"2022-10":0.178,"2022-11":0.177,
  "2022-12":0.168,"2023-01":0.167,"2023-02":0.182,"2023-03":0.161,"2023-04":0.148,
  "2023-05":0.130,"2023-06":0.115,"2023-07":0.102,"2023-08":0.103,"2023-09":0.085,
  "2023-10":0.065,"2023-11":0.062,"2023-12":0.062,"2024-01":0.038,"2024-02":0.029,
  "2024-03":0.020,"2024-04":0.024,"2024-05":0.026,"2024-06":0.025,"2024-07":0.042,
  "2024-08":0.042,"2024-09":0.048,"2024-10":0.049,"2024-11":0.047,"2024-12":0.046,
  "2025-01":0.052,"2025-02":0.053,"2025-03":0.049,"2025-04":0.043,"2025-05":0.033,
  "2025-06":0.026,"2025-07":0.042,"2025-08":0.041,"2025-09":0.043,"2025-10":0.039,
  "2025-11":0.042,"2025-12":0.047,"2026-01":0.050,"2026-02":0.053,"2026-03":0.053,
};

function getInflacja(year, month) {
  const key = `${year}-${String(month).padStart(2,"0")}`;
  return INFLACJA[key] ?? 0.04;
}

// ─── Typy obligacji ───────────────────────────────────────────────────────────
// Stawki domyślne to ostatnie znane emisje - użytkownik może wpisać własną
export const BOND_TYPES = {
  "TOS": {
    label: "TOS (3-latki, stałe)",
    months: 36,
    periods: 3,
    defaultRate: 0.0565,
    rateType: "fixed",       // stała przez cały okres
    coupon: false,           // kapitalizacja (nie wypłata kuponu)
    earlyRedemptionCost: 1.0,
  },
  "COI": {
    label: "COI (4-latki, inflacja)",
    months: 48,
    periods: 4,
    defaultRate: 0.0500,
    rateType: "inflation",   // rok1 stała, rok2+ inflacja + marża
    margin: 0.015,
    coupon: true,            // odsetki wypłacane co rok od nominału
    earlyRedemptionCost: 2.0,
  },
  "EDO": {
    label: "EDO (10-latki, inflacja)",
    months: 120,
    periods: 10,
    defaultRate: 0.0625,
    rateType: "inflation",   // rok1 stała, rok2+ inflacja + marża
    margin: 0.02,
    coupon: false,           // kapitalizacja
    earlyRedemptionCost: 3.0,
  },
  "ROR": {
    label: "ROR (roczne, zmienna)",
    months: 12,
    periods: 1,
    defaultRate: 0.0525,
    rateType: "fixed",
    coupon: true,
    earlyRedemptionCost: 0.5,
  },
  "DOR": {
    label: "DOR (2-latki, zmienna)",
    months: 24,
    periods: 2,
    defaultRate: 0.054,
    rateType: "fixed",
    coupon: true,
    earlyRedemptionCost: 0.7,
  },
  "ROS": {
    label: "ROS (6-latki, inflacja)",
    months: 72,
    periods: 6,
    defaultRate: 0.062,
    rateType: "inflation",
    margin: 0.02,
    coupon: false,
    earlyRedemptionCost: 2.0,
  },
  "ROD": {
    label: "ROD (12-latki, inflacja)",
    months: 144,
    periods: 12,
    defaultRate: 0.065,
    rateType: "inflation",
    margin: 0.025,
    coupon: false,
    earlyRedemptionCost: 3.0,
  },
};

// ─── Główny silnik obliczeń — zgodny z oficjalnym wzorem MF ──────────────────
// Wzór: WP_k = N_(k-1) * (1 + r_k * a_k / ACT_k) - b
// N_(k-1) = wartość na koniec poprzedniego okresu (zaokrąglona do gr)
// a_k = liczba dni od początku okresu do dnia d (włącznie z pierwszym, bez ostatniego)
// ACT_k = liczba dni w danym okresie odsetkowym

function calcSingleBond(params, purchaseDate, today, rate1) {
  const periods = params.periods;
  let val = 100.0; // N_0 = 100

  for (let k = 0; k < periods; k++) {
    const pStart = new Date(purchaseDate);
    pStart.setFullYear(pStart.getFullYear() + k);

    const pEnd = new Date(purchaseDate);
    pEnd.setFullYear(pEnd.getFullYear() + k + 1);

    // Stawka dla tego okresu
    let rate;
    if (k === 0) {
      rate = rate1;
    } else if (params.rateType === "inflation") {
      // inflacja z miesiąca poprzedzającego 1. miesiąc okresu
      const prevMonth = pStart.getMonth() === 0 ? 12 : pStart.getMonth();
      const prevYear = pStart.getMonth() === 0 ? pStart.getFullYear() - 1 : pStart.getFullYear();
      const inf = Math.max(0, getInflacja(prevYear, prevMonth));
      rate = inf + params.margin;
    } else {
      rate = rate1; // stała
    }

    const ACT = (pEnd - pStart) / 86400000;

    if (today <= pEnd) {
      // Jesteśmy w tym okresie — nalicz proporcjonalnie
      const a_k = (today - pStart) / 86400000;
      if (params.coupon) {
        // COI/ROR/DOR: odsetki od nominału, nie kapitalizowane
        val = Math.round((100.0 * (1 + rate * a_k / ACT)) * 100) / 100;
      } else {
        // TOS/EDO/ROS/ROD: kapitalizacja — val to N_(k-1)
        val = Math.round((val * (1 + rate * a_k / ACT)) * 100) / 100;
      }
      break;
    } else {
      // Okres minął
      if (params.coupon) {
        // Kupon wypłacony, wartość wraca do nominału dla kolejnego okresu
        val = 100.0;
      } else {
        // Kapitalizacja: val rośnie
        val = Math.round((val * (1 + rate)) * 100) / 100;
      }
    }
  }

  return val;
}

export function calcBondCurrentValue(bond) {
  const { type, purchaseDate, quantity, rate } = bond;
  const params = BOND_TYPES[type];
  if (!params || !purchaseDate || !quantity) {
    return { currentValue: (quantity || 0) * 100, earned: 0, dailyGain: 0, progress: 0 };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const purchase = new Date(purchaseDate);
  purchase.setHours(0, 0, 0, 0);
  const maturityDate = new Date(purchase);
  maturityDate.setFullYear(maturityDate.getFullYear() + params.periods);

  const totalDays = (maturityDate - purchase) / 86400000;
  const elapsedDays = Math.max(0, (today - purchase) / 86400000);
  const progress = Math.min(1, elapsedDays / totalDays);
  const totalNominal = quantity * 100;
  const bondRate = rate || params.defaultRate;

  let totalValue = 0;
  for (let i = 0; i < quantity; i++) {
    totalValue += calcSingleBond(params, purchase, today, bondRate);
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  let valueYesterday = 0;
  for (let i = 0; i < quantity; i++) {
    valueYesterday += calcSingleBond(params, purchase, yesterday, bondRate);
  }

  const earned = totalValue - totalNominal;
  const dailyGain = totalValue - valueYesterday;

  return {
    currentValue: Math.round(totalValue * 100) / 100,
    earned: Math.round(earned * 100) / 100,
    dailyGain: Math.round(dailyGain * 100) / 100,
    progress,
    maturityDate,
    totalNominal,
    bondRate,
  };
}

// ─── Style ────────────────────────────────────────────────────────────────────
const labelSt = {
  fontSize: 11, color: "#5a6a7e", display: "block",
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em"
};
const baseInp = {
  display: "block", width: "100%", padding: "9px 12px", fontSize: 13,
  borderRadius: 8, background: "#1a2535", border: "1px solid #243040",
  color: "#e8f0f8", fontFamily: "'Sora', sans-serif", outline: "none",
  WebkitAppearance: "none", boxSizing: "border-box",
  transition: "border-color .15s, box-shadow .15s",
};
function focusInp(e) { e.target.style.borderColor = "#f0a030"; e.target.style.boxShadow = "0 0 0 3px #f0a03018"; }
function blurInp(e) { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; }
function fmt(n) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function BondModal({ bond, onSave, onDelete, onClose }) {
  const isEdit = !!bond;
  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState(bond || {
    type: "TOS",
    quantity: "",
    purchaseDate: today,
    rate: "",
    note: "",
  });
  const [hovSave, setHovSave] = useState(false);
  const [hovDel, setHovDel] = useState(false);
  const [hovClose, setHovClose] = useState(false);

  const params = BOND_TYPES[form.type];
  const qty = parseInt(form.quantity) || 0;
  const bondRate = form.rate ? parseFloat(form.rate) / 100 : params?.defaultRate;

  let preview = null;
  if (qty > 0 && form.purchaseDate && bondRate) {
    preview = calcBondCurrentValue({
      type: form.type,
      purchaseDate: form.purchaseDate,
      quantity: qty,
      rate: bondRate,
    });
  }

  function submit() {
    if (!qty || !form.purchaseDate || !params) return;
    const maturityDate = new Date(form.purchaseDate);
    maturityDate.setFullYear(maturityDate.getFullYear() + params.periods);
    onSave({
      ...form,
      id: bond?.id || Date.now(),
      quantity: qty,
      rate: bondRate,
      purchaseAmount: qty * 100,
      maturityDate: maturityDate.toISOString().split("T")[0],
      name: `${form.type} – ${qty} szt. (${(bondRate * 100).toFixed(2)}%)`,
      category: "Obligacje",
      value: preview ? preview.currentValue : qty * 100,
      isBond: true,
    });
    onClose();
  }

  const rateInfo = params?.rateType === "inflation"
    ? `Rok 1: stałe, Rok 2+: inflacja GUS + ${((params.margin || 0) * 100).toFixed(1)}% marży`
    : `Stałe przez cały okres`;

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>{isEdit ? "Edytuj obligacje" : "Dodaj obligacje"}</div>
          <button onClick={onClose} onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Rodzaj obligacji</label>
          <select style={baseInp} value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value, rate: "" }))}
            onFocus={focusInp} onBlur={blurInp}>
            {Object.entries(BOND_TYPES).map(([key, val]) => (
              <option key={key} value={key} style={{ background: "#1a2535" }}>{val.label}</option>
            ))}
          </select>
        </div>

        {params && (
          <div style={{ background: "#0f1a27", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#5a7a9e", lineHeight: 1.8 }}>
            <span style={{ color: "#f0a030", fontWeight: 600 }}>Oprocentowanie: </span>{rateInfo}
            <br />
            <span style={{ color: "#f0a030", fontWeight: 600 }}>Zapadalność: </span>{params.months} mies.
            {" · "}
            <span style={{ color: "#f0a030", fontWeight: 600 }}>
              {params.coupon ? "Kupony roczne" : "Kapitalizacja roczna"}
            </span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelSt}>Liczba obligacji (1 szt. = 100 zł)</label>
            <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" min="1" placeholder="np. 100"
              value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              onFocus={focusInp} onBlur={blurInp} />
          </div>
          <div>
            <label style={labelSt}>Data zakupu</label>
            <input style={baseInp} type="date" value={form.purchaseDate}
              onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))}
              onFocus={focusInp} onBlur={blurInp} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>
            Oprocentowanie roku 1 (%) — z listu emisyjnego
            <span style={{ color: "#4a5a6e", marginLeft: 6, fontWeight: 400 }}>
              domyślnie {(params?.defaultRate * 100).toFixed(2)}%
            </span>
          </label>
          <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number"
            step="0.01" placeholder={`np. ${(params?.defaultRate * 100).toFixed(2)}`}
            value={form.rate}
            onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
            onFocus={focusInp} onBlur={blurInp} />
          <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>
            Znajdziesz na obligacjeskarbowe.pl → Twoja seria, np. TOS1227 = 5.95%
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Notatka (opcjonalnie)</label>
          <input style={baseInp} placeholder="np. TOS1227, IKE..." value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            onFocus={focusInp} onBlur={blurInp} />
        </div>

        {preview && (
          <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Stan obecny</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Kwota zakupu</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmt(qty * 100)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Obecna wartość</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#00c896", fontFamily: "'DM Mono', monospace" }}>{fmt(preview.currentValue)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Narosłe odsetki</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#f0a030", fontFamily: "'DM Mono', monospace" }}>+{fmt(preview.earned)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Przyrost dzienny</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#a78bfa", fontFamily: "'DM Mono', monospace" }}>+{fmt(preview.dailyGain)}/dzień</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 6, background: "#1e2a38", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: (preview.progress * 100) + "%", height: "100%", background: "#f0a030", borderRadius: 99 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "#5a7a9e" }}>
                <span>{new Date(form.purchaseDate).toLocaleDateString("pl-PL")}</span>
                <span>{Math.round(preview.progress * 100)}% czasu</span>
                <span>{preview.maturityDate?.toLocaleDateString("pl-PL")}</span>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={submit} onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
            style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "2px solid #f0a030", background: hovSave ? "#f0a03012" : "transparent", color: "#f0a030", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Sora', sans-serif", boxShadow: hovSave ? "0 0 14px #f0a030" : "0 0 8px #f0a03030", transition: "all .2s" }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj obligacje"}
          </button>
          {isEdit && (
            <button onClick={() => { onDelete(bond.id); onClose(); }}
              onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${hovDel ? "#f05060" : "#f0506040"}`, background: hovDel ? "#f0506018" : "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", transition: "all .15s" }}>Usuń</button>
          )}
          <button onClick={onClose}
            style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #f0506040", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer" }}>Anuluj</button>
        </div>
      </div>
    </div>
  );
}

// ─── Wiersz na liście ─────────────────────────────────────────────────────────
export function BondRow({ bond, onClick }) {
  const calc = calcBondCurrentValue(bond);
  const [hov, setHov] = useState(false);
  const gainPct = bond.purchaseAmount > 0
    ? ((calc.currentValue - bond.purchaseAmount) / bond.purchaseAmount * 100) : 0;

  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8, border: `1px solid ${hov ? "#f0a03050" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s" }}>
      <div style={{ width: 4, height: 36, borderRadius: 2, background: "#f0a030", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#e8f0f8" }}>{bond.name}</div>
        <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 2 }}>
          zakup: {new Date(bond.purchaseDate).toLocaleDateString("pl-PL")}
          {" · "}wykup: {new Date(bond.maturityDate).toLocaleDateString("pl-PL")}
          {" · "}{Math.round(calc.progress * 100)}% czasu
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8" }}>{fmt(calc.currentValue)}</div>
        <div style={{ fontSize: 11, color: "#f0a030", fontFamily: "'DM Mono', monospace", marginTop: 2 }}>
          +{fmt(calc.dailyGain)}/dzień · +{gainPct.toFixed(2)}%
        </div>
      </div>
      <div style={{ width: 50, height: 4, background: "#1e2a38", borderRadius: 2, flexShrink: 0, overflow: "hidden" }}>
        <div style={{ width: (calc.progress * 100) + "%", height: "100%", background: "#f0a030", borderRadius: 2 }} />
      </div>
    </div>
  );
}
