import { useState } from "react";

// ─── Typy obligacji i ich parametry ──────────────────────────────────────────
const BOND_TYPES = {
  "ROR": {
    label: "ROR (roczne, 1 rok)",
    months: 12,
    firstRate: 0.0525,
    indexed: "nbp",
    margin: 0,
    couponEveryMonths: 1,
    capitalizeEveryMonths: null,
    earlyRedemptionCost: 0.5,
  },
  "DOR": {
    label: "DOR (2-latki, 2 lata)",
    months: 24,
    firstRate: 0.054,
    indexed: "nbp",
    margin: 0.0015,
    couponEveryMonths: 1,
    capitalizeEveryMonths: null,
    earlyRedemptionCost: 0.7,
  },
  "TOS": {
    label: "TOS (3-latki, 3 lata)",
    months: 36,
    firstRate: 0.0565,
    indexed: "wibor6m",
    margin: 0,
    couponEveryMonths: null,
    capitalizeEveryMonths: 12,
    earlyRedemptionCost: 1.0,
  },
  "COI": {
    label: "COI (4-latki, 4 lata)",
    months: 48,
    firstRate: 0.06,
    indexed: "inflation",
    margin: 0.015,
    couponEveryMonths: 12,
    capitalizeEveryMonths: null,
    earlyRedemptionCost: 2.0,
  },
  "EDO": {
    label: "EDO (10-latki, 10 lat)",
    months: 120,
    firstRate: 0.0625,
    indexed: "inflation",
    margin: 0.02,
    couponEveryMonths: null,
    capitalizeEveryMonths: 12,
    earlyRedemptionCost: 3.0,
  },
  "ROS": {
    label: "ROS (6-latki, 6 lat)",
    months: 72,
    firstRate: 0.062,
    indexed: "inflation",
    margin: 0.02,
    couponEveryMonths: null,
    capitalizeEveryMonths: 12,
    earlyRedemptionCost: 2.0,
  },
  "ROD": {
    label: "ROD (12-latki, 12 lat)",
    months: 144,
    firstRate: 0.065,
    indexed: "inflation",
    margin: 0.025,
    couponEveryMonths: null,
    capitalizeEveryMonths: 12,
    earlyRedemptionCost: 3.0,
  },
};

// Aktualne wskaźniki (dane historyczne + bieżące)
const CURRENT_NBP = 0.0525;
const CURRENT_INFLATION = 0.04;
const CURRENT_WIBOR6M = 0.0505;

// ─── Silnik obliczeń obligacji ────────────────────────────────────────────────
function calcBondCurrentValue(bond) {
  const { type, purchaseDate, purchaseAmount, quantity } = bond;
  const params = BOND_TYPES[type];
  if (!params) return { currentValue: purchaseAmount, earned: 0, dailyGain: 0, progress: 0 };

  const today = new Date();
  const purchase = new Date(purchaseDate);
  const maturityDate = new Date(purchase);
  maturityDate.setMonth(maturityDate.getMonth() + params.months);

  const totalDays = (maturityDate - purchase) / (1000 * 60 * 60 * 24);
  const elapsedDays = Math.max(0, (today - purchase) / (1000 * 60 * 60 * 24));
  const progress = Math.min(1, elapsedDays / totalDays);

  const nominalPerBond = 100;
  const totalNominal = quantity * nominalPerBond;
  const yearlyRate = getEffectiveRate(params);

  let currentValue;
  let earned;

  if (params.capitalizeEveryMonths) {
    // Obligacje z kapitalizacją (TOS, EDO, ROS, ROD)
    const elapsedYears = elapsedDays / 365.25;
    const firstYearRate = params.firstRate;
    const subsequentRate = yearlyRate;

    if (elapsedDays <= 365) {
      // Pierwsze 12 miesięcy — stała stawka
      earned = totalNominal * firstYearRate * (elapsedDays / 365);
    } else {
      // Po pierwszym roku — kapitalizacja roczna z marżą + wskaźnik
      const fullYears = Math.floor(elapsedYears);
      const remainingDays = elapsedDays - fullYears * 365;
      let val = totalNominal;
      // Rok 1
      val = val * (1 + firstYearRate);
      // Kolejne lata
      for (let y = 2; y <= fullYears; y++) {
        val = val * (1 + subsequentRate);
      }
      // Bieżący niepełny rok
      val = val * (1 + subsequentRate * (remainingDays / 365));
      earned = val - totalNominal;
    }
    currentValue = totalNominal + earned;
  } else {
    // Obligacje z kuponem (ROR, DOR, COI)
    const firstYearRate = params.firstRate;
    const subsequentRate = yearlyRate;
    const elapsedYears = elapsedDays / 365.25;

    if (elapsedDays <= 365) {
      earned = totalNominal * firstYearRate * (elapsedDays / 365);
    } else {
      const fullYears = Math.floor(elapsedYears);
      const remainingDays = elapsedDays - fullYears * 365;
      earned = totalNominal * firstYearRate; // Rok 1 — odsetki wypłacone
      for (let y = 2; y <= fullYears; y++) {
        earned += totalNominal * subsequentRate; // Kolejne lata
      }
      earned += totalNominal * subsequentRate * (remainingDays / 365); // Bieżący rok
    }
    currentValue = totalNominal + earned;
  }

  // Zysk dzienny
  const dailyRate = yearlyRate / 365;
  const currentBase = Math.max(totalNominal, currentValue - (currentValue * dailyRate));
  const dailyGain = currentBase * dailyRate;

  return {
    currentValue: Math.round(currentValue * 100) / 100,
    earned: Math.round(earned * 100) / 100,
    dailyGain: Math.round(dailyGain * 100) / 100,
    progress,
    maturityDate,
    totalNominal,
    yearlyRate,
  };
}

function getEffectiveRate(params) {
  if (params.indexed === "nbp") return CURRENT_NBP + params.margin;
  if (params.indexed === "inflation") return CURRENT_INFLATION + params.margin;
  if (params.indexed === "wibor6m") return CURRENT_WIBOR6M + params.margin;
  return params.firstRate;
}

// ─── Shared styles ────────────────────────────────────────────────────────────
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
  return new Intl.NumberFormat("pl-PL", {
    style: "currency", currency: "PLN", maximumFractionDigits: 2
  }).format(n);
}

// ─── Modal obligacji ──────────────────────────────────────────────────────────
export function BondModal({ bond, onSave, onDelete, onClose }) {
  const isEdit = !!bond;
  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState(bond || {
    type: "EDO",
    quantity: "",
    purchaseDate: today,
    note: "",
  });
  const [hovSave, setHovSave] = useState(false);
  const [hovDel, setHovDel] = useState(false);
  const [hovClose, setHovClose] = useState(false);

  const params = BOND_TYPES[form.type];
  const purchaseAmount = (parseInt(form.quantity) || 0) * 100;

  // Podgląd obliczeń
  let preview = null;
  if (form.quantity && form.purchaseDate && parseInt(form.quantity) > 0) {
    const maturity = new Date(form.purchaseDate);
    maturity.setMonth(maturity.getMonth() + params.months);
    preview = calcBondCurrentValue({
      type: form.type,
      purchaseDate: form.purchaseDate,
      purchaseAmount,
      quantity: parseInt(form.quantity),
    });
  }

  function submit() {
    const qty = parseInt(form.quantity);
    if (!qty || qty <= 0 || !form.purchaseDate) return;
    const maturityDate = new Date(form.purchaseDate);
    maturityDate.setMonth(maturityDate.getMonth() + params.months);
    onSave({
      ...form,
      id: bond?.id || Date.now(),
      quantity: qty,
      purchaseAmount: qty * 100,
      maturityDate: maturityDate.toISOString().split("T")[0],
      name: `${form.type} – ${qty} szt.`,
      category: "Obligacje",
      value: preview ? preview.currentValue : qty * 100,
      isBond: true,
    });
    onClose();
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>
            {isEdit ? "Edytuj obligacje" : "Dodaj obligacje"}
          </div>
          <button onClick={onClose}
            onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        {/* Rodzaj */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Rodzaj obligacji</label>
          <select style={baseInp} value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            onFocus={focusInp} onBlur={blurInp}>
            {Object.entries(BOND_TYPES).map(([key, val]) => (
              <option key={key} value={key} style={{ background: "#1a2535" }}>{val.label}</option>
            ))}
          </select>
        </div>

        {/* Parametry wybranej obligacji */}
        {params && (
          <div style={{ background: "#0f1a27", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#5a7a9e", lineHeight: 1.8 }}>
            <span style={{ color: "#f0a030", fontWeight: 600 }}>Oprocentowanie rok 1: </span>{(params.firstRate * 100).toFixed(2)}%
            {" · "}
            <span style={{ color: "#f0a030", fontWeight: 600 }}>Wskaźnik: </span>
            {params.indexed === "nbp" ? `stopa NBP (${(CURRENT_NBP * 100).toFixed(2)}%)` : params.indexed === "inflation" ? `inflacja (${(CURRENT_INFLATION * 100).toFixed(2)}%) + marża ${(params.margin * 100).toFixed(2)}%` : `WIBOR 6M (${(CURRENT_WIBOR6M * 100).toFixed(2)}%)`}
            {" · "}
            <span style={{ color: "#f0a030", fontWeight: 600 }}>Zapadalność: </span>{params.months} mies.
          </div>
        )}

        {/* Ilość i data */}
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

        {/* Notatka */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Notatka (opcjonalnie)</label>
          <input style={baseInp} placeholder="np. seria, cel..." value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            onFocus={focusInp} onBlur={blurInp} />
        </div>

        {/* Podgląd obliczenia */}
        {preview && (
          <div style={{ background: "#0f1a27", border: "1px solid #1e3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Szacunkowy stan obecny</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Kwota zakupu</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmt(purchaseAmount)}</div>
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
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zysk dzienny (~)</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#a78bfa", fontFamily: "'DM Mono', monospace" }}>+{fmt(preview.dailyGain)}/dzień</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 6, background: "#1e2a38", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: (preview.progress * 100) + "%", height: "100%", background: "#f0a030", borderRadius: 99, transition: "width .3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "#5a7a9e" }}>
                <span>{new Date(form.purchaseDate).toLocaleDateString("pl-PL")}</span>
                <span>{Math.round(preview.progress * 100)}% do wykupu</span>
                <span>{preview.maturityDate.toLocaleDateString("pl-PL")}</span>
              </div>
            </div>
          </div>
        )}

        {/* Przyciski */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={submit}
            onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
            style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "2px solid #f0a030", background: hovSave ? "#f0a03012" : "transparent", color: "#f0a030", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Sora', sans-serif", boxShadow: hovSave ? "0 0 14px #f0a030" : "0 0 8px #f0a03030", transition: "all .2s" }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj obligacje"}
          </button>
          {isEdit && (
            <button onClick={() => { onDelete(bond.id); onClose(); }}
              onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${hovDel ? "#f05060" : "#f0506040"}`, background: hovDel ? "#f0506018" : "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", fontFamily: "'Sora', sans-serif", transition: "all .15s" }}>Usuń</button>
          )}
          <button onClick={onClose}
            style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #f0506040", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", fontFamily: "'Sora', sans-serif" }}>Anuluj</button>
        </div>
      </div>
    </div>
  );
}

// ─── Wiersz obligacji na liście aktywów ───────────────────────────────────────
export function BondRow({ bond, onClick }) {
  const calc = calcBondCurrentValue(bond);
  const [hov, setHov] = useState(false);
  const gainPct = bond.purchaseAmount > 0 ? ((calc.currentValue - bond.purchaseAmount) / bond.purchaseAmount * 100) : 0;

  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8, border: `1px solid ${hov ? "#f0a03050" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s" }}>
      <div style={{ width: 4, height: 36, borderRadius: 2, background: "#f0a030", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#e8f0f8" }}>{bond.name}</div>
        <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 2 }}>
          zakup: {new Date(bond.purchaseDate).toLocaleDateString("pl-PL")} · wykup: {new Date(bond.maturityDate).toLocaleDateString("pl-PL")}
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

export { calcBondCurrentValue, BOND_TYPES };
