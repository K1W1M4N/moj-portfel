// src/CurrencyModal.jsx
import { useState, useEffect } from "react";
import { fetchFxRate } from "./fxUtils";

// ─── Konfiguracja walut ───────────────────────────────────────────────────────
export const SUPPORTED_CURRENCIES = [
  { code: "PLN", name: "Złoty polski", symbol: "zł" },
  { code: "USD", name: "Dolar amerykański", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "Funt brytyjski", symbol: "£" },
  { code: "CHF", name: "Frank szwajcarski", symbol: "Fr" },
];

const CATEGORY_COLOR = "#3b9eff"; // Kolor kategorii "Waluty"

// ─── Style ────────────────────────────────────────────────────────────────────
const labelSt = {
  fontSize: 11, color: "#5a6a7e", display: "block",
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em",
};
const baseInp = {
  display: "block", width: "100%", padding: "9px 12px", fontSize: 13,
  borderRadius: 8, background: "#1a2535", border: "1px solid #243040",
  color: "#e8f0f8", fontFamily: "'Sora', sans-serif", outline: "none",
  WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
  boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s",
};
const focusInp = e => { e.target.style.borderColor = "#3b9eff"; e.target.style.boxShadow = "0 0 0 3px #3b9eff18"; };
const blurInp  = e => { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; };

const fmtPLN = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n);
const fmtCurr = (n, code) => n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + code;

// ─── Modal dodawania/edycji waluty ───────────────────────────────────────────
export function CurrencyModal({ asset, onSave, onDelete, onClose, onMove }) {
  const isEdit = !!asset;
  const [menuOpen, setMenuOpen] = useState(false);
  
  const [name, setName] = useState(asset?.name || "");
  const [currencyCode, setCurrencyCode] = useState(asset?.currencyCode || "USD");
  const [amount, setAmount] = useState(asset?.currencyAmount || "");
  const [purchaseRate, setPurchaseRate] = useState(asset?.currencyPurchaseRate || "");
  const [note, setNote] = useState(asset?.note || "");
  
  const [currentRate, setCurrentRate] = useState(null);
  const [loadingRate, setLoadingRate] = useState(false);
  const [hovSave, setHovSave] = useState(false);
  const [hovDel, setHovDel] = useState(false);
  const [hovClose, setHovClose]   = useState(false);

  // Pobierz aktualny kurs gdy zmieni się waluta
  useEffect(() => {
    if (currencyCode === "PLN") {
      setCurrentRate(1);
      return;
    }
    setLoadingRate(true);
    fetchFxRate(currencyCode).then(rate => {
      setCurrentRate(rate);
      setLoadingRate(false);
    });
  }, [currencyCode]);

  const numAmount = parseFloat(String(amount).replace(",", ".")) || 0;
  const numCurrentRate = currentRate || 1;
  const numPurchaseRate = parseFloat(String(purchaseRate).replace(",", ".")) || numCurrentRate;

  const currentValuePLN = numAmount * numCurrentRate;
  const totalPaidPLN = numAmount * numPurchaseRate;
  const pnlPLN = currentValuePLN - totalPaidPLN;
  const pnlPct = totalPaidPLN > 0 ? (pnlPLN / totalPaidPLN) * 100 : 0;

  const handleSave = () => {
    if (!name || numAmount <= 0) return;

    onSave({
      id: asset?.id || Date.now(),
      name,
      category: "Waluty",
      value: currentValuePLN,
      note,
      isCurrency: true,
      currencyCode,
      currencyAmount: numAmount,
      currencyPurchaseRate: numPurchaseRate !== numCurrentRate ? numPurchaseRate : null,
    });
    onClose();
  };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>
            {isEdit ? "Edytuj walutę" : "Dodaj walutę / gotówkę"}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {isEdit && onMove && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setMenuOpen(o => !o)}
                  style={{ background: menuOpen ? "#1e2a38" : "transparent", border: `1px solid ${menuOpen ? "#2a3a50" : "#1e2a38"}`, borderRadius: 8, color: "#8a9bb0", cursor: "pointer", width: 32, height: 32, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  ···
                </button>
                {menuOpen && (
                  <div style={{ position: "absolute", top: 38, right: 0, background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10, padding: "4px", minWidth: 150, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 10 }}>
                    <button onClick={() => { setMenuOpen(false); onMove(asset); }}
                      style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      💼 Przenieś
                    </button>
                  </div>
                )}
              </div>
            )}
            <button onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
              onClick={onClose} style={{
                background: hovClose ? "#f0506018" : "#161d28",
                border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`,
                borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18,
                width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s"
              }}>×</button>
          </div>
        </div>

        {/* Nazwa */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Nazwa (np. Sejf, Portfel, Konto USD)</label>
          <input style={baseInp} value={name} onChange={e => setName(e.target.value)}
            placeholder="np. Moje dolary" autoFocus onFocus={focusInp} onBlur={blurInp} />
        </div>

        {/* Waluta i Ilość */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelSt}>Waluta</label>
            <select style={baseInp} value={currencyCode} onChange={e => setCurrencyCode(e.target.value)} onFocus={focusInp} onBlur={blurInp}>
              {SUPPORTED_CURRENCIES.map(c => (
                <option key={c.code} value={c.code} style={{ background: "#1a2535" }}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelSt}>Ilość</label>
            <input style={baseInp} type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" onFocus={focusInp} onBlur={blurInp} />
          </div>
        </div>

        {/* Kursy */}
        <div style={{ background: "#0f1a27", borderRadius: 12, padding: "14px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "#5a6a7e", textTransform: "uppercase" }}>Aktualny kurs</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#3b9eff", fontFamily: "'DM Mono', monospace" }}>
                {loadingRate ? "..." : `1 ${currencyCode} = ${numCurrentRate.toFixed(4)} PLN`}
              </div>
            </div>
            {currencyCode !== "PLN" && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#5a6a7e", textTransform: "uppercase" }}>Wartość PLN</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>
                  {fmtPLN(currentValuePLN)}
                </div>
              </div>
            )}
          </div>
          
          {currencyCode !== "PLN" && (
            <div>
              <label style={{ ...labelSt, fontSize: 10 }}>Kurs zakupu (opcjonalnie)</label>
              <input style={{ ...baseInp, padding: "6px 10px", fontSize: 12, background: "#111b27" }} 
                type="number" step="any" value={purchaseRate} onChange={e => setPurchaseRate(e.target.value)}
                placeholder="Przelicznik po jakim kupiłeś" onFocus={focusInp} onBlur={blurInp} />
              <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 4 }}>
                Pozostaw puste, aby użyć aktualnego kursu
              </div>
            </div>
          )}
        </div>

        {/* Wynik PnL */}
        {currencyCode !== "PLN" && purchaseRate && numAmount > 0 && (
          <div style={{ background: pnlPLN >= 0 ? "#00c89610" : "#f0506010", border: `1px solid ${pnlPLN >= 0 ? "#00c89630" : "#f0506030"}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#8a9bb0" }}>Zysk / Strata na kursie:</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
                {pnlPLN >= 0 ? "+" : ""}{fmtPLN(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
              </span>
            </div>
          </div>
        )}

        {/* Notatka */}
        <div style={{ marginBottom: 22 }}>
          <label style={labelSt}>Notatka</label>
          <input style={baseInp} value={note} onChange={e => setNote(e.target.value)}
            placeholder="Dodatkowe informacje..." onFocus={focusInp} onBlur={blurInp} />
        </div>

        {/* Przyciski */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
            onClick={handleSave} style={{
              flex: 2, padding: "12px", borderRadius: 10, border: "2px solid #3b9eff",
              background: hovSave ? "#3b9eff12" : "transparent", color: "#3b9eff",
              fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Sora', sans-serif",
              transition: "all .2s", boxShadow: hovSave ? "0 0 15px #3b9eff40" : "none"
            }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj walutę"}
          </button>
          {isEdit && (
            <button onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              onClick={() => { onDelete(asset.id); onClose(); }} style={{
                flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #f0506040",
                background: hovDel ? "#f0506018" : "transparent", color: "#f05060",
                fontSize: 14, cursor: "pointer", fontFamily: "'Sora', sans-serif", transition: "all .15s"
              }}>Usuń</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Wiersz waluty na liście ─────────────────────────────────────────────────
export function CurrencyRow({ asset, color, onClick }) {
  const [hov, setHov] = useState(false);
  
  const [currentRate, setCurrentRate] = useState(asset.value / asset.currencyAmount);
  const currency = SUPPORTED_CURRENCIES.find(c => c.code === asset.currencyCode) || SUPPORTED_CURRENCIES[0];

  useEffect(() => {
    if (asset.currencyCode === "PLN") return;
    fetchFxRate(asset.currencyCode).then(rate => setCurrentRate(rate));
  }, [asset.currencyCode]);

  const displayValuePLN = asset.currencyAmount * currentRate;
  const purchaseValuePLN = asset.currencyAmount * (asset.currencyPurchaseRate || currentRate);
  const pnlPLN = displayValuePLN - purchaseValuePLN;
  const pnlPct = purchaseValuePLN > 0 ? (pnlPLN / purchaseValuePLN) * 100 : 0;

  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8,
        border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s"
      }}>
      <div style={{ width: 4, borderRadius: 2, background: color, flexShrink: 0, alignSelf: "stretch" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#e8f0f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {asset.name}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8" }}>
            {fmtPLN(displayValuePLN)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4a5a6e" }}>
            {fmtCurr(asset.currencyAmount, asset.currencyCode)}
            {asset.currencyCode !== "PLN" && (
              <span style={{ marginLeft: 6, color: "#2d3d4d" }}>@ {currentRate.toFixed(4)}</span>
            )}
          </div>
          {asset.currencyCode !== "PLN" && asset.currencyPurchaseRate && (
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
              {pnlPLN >= 0 ? "+" : ""}{pnlPLN.toFixed(2)} zł ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
