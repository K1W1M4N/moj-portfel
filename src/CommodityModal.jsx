// src/CommodityModal.jsx
import { useState, useEffect, useCallback } from "react";

// ─── Stałe surowców ───────────────────────────────────────────────────────────
export const COMMODITIES = [
  { symbol: "XAU", name: "Złoto",   nameEn: "Gold",      icon: "🥇", color: "#f5c842", unit: "oz" },
  { symbol: "XAG", name: "Srebro",  nameEn: "Silver",    icon: "🥈", color: "#b0b8c8", unit: "oz" },
  { symbol: "XPT", name: "Platyna", nameEn: "Platinum",  icon: "🤍", color: "#a0c0d8", unit: "oz" },
  { symbol: "XPD", name: "Pallad",  nameEn: "Palladium", icon: "🔵", color: "#9090c0", unit: "oz" },
];

// Przelicznik jednostka → uncje troy
const TO_OZ = { oz: 1, g: 0.032150747, kg: 32.150747 };

const UNIT_LABELS = { oz: "uncja troy (oz)", g: "gram (g)", kg: "kilogram (kg)" };
const CURRENCY_LABELS = { PLN: "PLN", USD: "USD", EUR: "EUR" };

// Kolor kategorii "Surowce" z wykresu kołowego
const CATEGORY_COLOR = "#00d4f0";

function getCommodity(symbol) {
  return COMMODITIES.find(c => c.symbol === symbol) || COMMODITIES[0];
}

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
const focusInp = e => { e.target.style.borderColor = "#f5c842"; e.target.style.boxShadow = "0 0 0 3px #f5c84218"; };
const blurInp  = e => { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; };

const fmtPLN  = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
const fmtPLN2 = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n);
const fmtUSD  = n => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";

import { fetchFxRate } from "./fxUtils";

// ─── Cache cen surowców w localStorage ───────────────────────────────────────
const COMMODITY_CACHE_KEY = "pt-commodity-cache";
function loadCommodityCache() {
  try { const r = localStorage.getItem(COMMODITY_CACHE_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveCommodityCache(data) {
  try { localStorage.setItem(COMMODITY_CACHE_KEY, JSON.stringify(data)); } catch {}
}

// TTL cache: 30 minut
const CACHE_TTL_MS = 30 * 60 * 1000;

// ─── Hook: live ceny surowców ─────────────────────────────────────────────────
export function useCommodityPrices(assets) {
  const [commodityPrices, setCommodityPrices] = useState(() => {
    // Inicjalizuj z cache jeśli TTL nie upłynął
    const cache = loadCommodityCache();
    const now = Date.now();
    const initial = {};
    for (const [sym, entry] of Object.entries(cache)) {
      if (entry.priceUSD && (now - (entry.ts || 0)) < CACHE_TTL_MS) {
        initial[sym] = { ...entry, fromCache: true };
      }
    }
    return initial;
  });
  const [commodityLastUpdated, setCommodityLastUpdated] = useState(null);

  // Tylko unikalne symbole surowców z aktywów
  const commodityAssets = assets.filter(a => a.isCommodity && a.commoditySymbol);
  const symbolsKey = [...new Set(commodityAssets.map(a => a.commoditySymbol))].sort().join(",");

  const fetchAll = useCallback(async () => {
    if (commodityAssets.length === 0) return;

    const symbols = [...new Set(commodityAssets.map(a => a.commoditySymbol))];

    // Zawsze pobieramy fresh USD/PLN kurs
    const usdPLN = await fetchFxRate("USD");
    const eurPLN = await fetchFxRate("EUR");

    try {
      const url = `/api/commodity-price?symbols=${symbols.join(",")}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
      const data = await res.json();

      const newPrices = {};
      for (const sym of symbols) {
        const pd = data.prices?.[sym];
        if (pd?.priceUSD) {
          newPrices[sym] = {
            priceUSD: pd.priceUSD,
            pricePLN: pd.priceUSD * usdPLN,
            usdPLN,
            eurPLN,
            provider: pd.provider,
            ts: Date.now(),
            fromCache: false,
          };
        }
      }

      if (Object.keys(newPrices).length > 0) {
        setCommodityPrices(prev => {
          const merged = { ...prev, ...newPrices };
          saveCommodityCache(merged);
          return merged;
        });
        setCommodityLastUpdated(new Date());
      }
    } catch (e) {
      console.warn("Commodity proxy error:", e);
      // Cache zostaje — nie zerujemy cen
    }
  }, [symbolsKey]);

  useEffect(() => {
    fetchAll();
    // Odświeżaj co 30 minut — oszczędza limit GoldAPI
    const iv = setInterval(fetchAll, 30 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  return { commodityPrices, commodityLastUpdated };
}

// ─── Helper: przelicz ilość na uncje ─────────────────────────────────────────
export function toOz(amount, unit) {
  return (parseFloat(amount) || 0) * (TO_OZ[unit] || 1);
}

// ─── Helper: aktualna wartość PLN surowca ─────────────────────────────────────
export function calcCommodityValue(asset, commodityPrices) {
  const pd = commodityPrices[asset.commoditySymbol];
  if (!pd?.pricePLN) return asset.commodityPaidPLN || 0;
  const oz = toOz(asset.commodityAmount, asset.commodityUnit);
  return oz * pd.pricePLN;
}

// ─── Panel szczegółów surowca ─────────────────────────────────────────────────
export function CommodityDetailPanel({ asset, commodityPrices, onEdit, onDelete, onClose, onMove }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const commodity = getCommodity(asset.commoditySymbol);
  const pd = commodityPrices[asset.commoditySymbol];
  const priceUSD = pd?.priceUSD;
  const pricePLN = pd?.pricePLN;
  const usdPLN = pd?.usdPLN;
  const provider = pd?.provider;
  const fromCache = pd?.fromCache;
  const cacheAge = pd?.ts ? Math.round((Date.now() - pd.ts) / 60000) : null;
  const providerLabel = { yahoo: "Yahoo Finance", goldapi: "GoldAPI.io", fallback: "dane szacunkowe" }[provider] || "—";

  const oz = toOz(asset.commodityAmount, asset.commodityUnit);
  const currentValuePLN = pricePLN ? oz * pricePLN : null;
  const paidPLN = asset.commodityPaidPLN || 0;
  const pnlPLN = currentValuePLN !== null ? currentValuePLN - paidPLN : null;
  const pnlPct = paidPLN > 0 && pnlPLN !== null ? (pnlPLN / paidPLN) * 100 : null;

  const lots = asset.commodityLots || [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: "20px 16px", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f0f8", marginBottom: 2, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: CATEGORY_COLOR, fontFamily: "'DM Mono', monospace" }}>{commodity.name}</span>
              {asset.commodityCustomName && (
                <span style={{ fontSize: 13, color: "#8a9bb0", fontWeight: 400 }}>· {asset.commodityCustomName}</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#5a6a7e" }}>
              {asset.commodityAmount} {asset.commodityUnit}
              {asset.commodityUnit !== "oz" && (
                <span style={{ marginLeft: 6, color: "#3a4a5e" }}>= {oz.toFixed(4)} oz</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setMenuOpen(o => !o)}
                style={{ background: menuOpen ? "#1e2a38" : "transparent", border: `1px solid ${menuOpen ? "#2a3a50" : "#1e2a38"}`, borderRadius: 8, color: "#8a9bb0", cursor: "pointer", width: 32, height: 32, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ···
              </button>
              {menuOpen && (
                <div style={{ position: "absolute", top: 38, right: 0, background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10, padding: "4px", minWidth: 150, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 10 }}>
                  <button onClick={() => { setMenuOpen(false); onEdit(asset); }}
                    style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    Edytuj
                  </button>
                  {onMove && (
                    <button onClick={() => { setMenuOpen(false); onMove(asset); }}
                      style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      Przenieś
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); onDelete(asset.id); onClose(); }}
                    style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#f05060", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0506018"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    Usuń
                  </button>
                </div>
              )}
            </div>
            <button onClick={onClose}
              style={{ background: "transparent", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: "pointer", width: 30, height: 30, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        </div>

        {/* Cena spot live */}
        <div style={{ background: "#0f1a27", borderRadius: 12, padding: "14px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Cena spot (1 oz)</div>
          {priceUSD ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: commodity.color, fontFamily: "'DM Mono', monospace" }}>
                  {fmtUSD(priceUSD)}
                </div>
                {usdPLN && (
                  <div style={{ fontSize: 13, color: "#8a9bb0", marginTop: 2 }}>
                    ≈ {fmtPLN2(priceUSD * usdPLN)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#3a4a5e" }}>pobieranie ceny...</div>
          )}
        </div>

        {/* Wartości grid 2×2 */}
        <div style={{ background: "#0f1a27", borderRadius: 12, padding: "14px 14px", marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
            <div>
              <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Zainwestowano</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono',monospace" }}>{fmtPLN2(paidPLN)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Aktualna wartość</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: commodity.color, fontFamily: "'DM Mono',monospace" }}>
                {currentValuePLN !== null ? fmtPLN2(currentValuePLN) : "—"}
              </div>
            </div>
            {pnlPLN !== null && (
              <>
                <div>
                  <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Zysk / Strata</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: pnlPLN >= 0 ? "#00c896" : "#f05060", fontFamily: "'DM Mono',monospace" }}>
                    {pnlPLN >= 0 ? "+" : ""}{fmtPLN2(pnlPLN)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Zmiana %</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: pnlPLN >= 0 ? "#00c896" : "#f05060", fontFamily: "'DM Mono',monospace" }}>
                    {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Historia zakupów */}
        {lots.length > 0 && (
          <div style={{ background: "#0f1a27", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Historia zakupów</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lots.map((lot, i) => {
                const lotOz = toOz(lot.amount, lot.unit || asset.commodityUnit);
                const lotPaid = parseFloat(lot.paidTotal) || 0;
                const lotCurVal = pricePLN ? lotOz * pricePLN : null;
                const lotPnl = lotCurVal !== null ? lotCurVal - lotPaid : null;
                const lotPct = lotPaid > 0 && lotPnl !== null ? (lotPnl / lotPaid) * 100 : null;
                return (
                  <div key={i} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #1e2a38" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: commodity.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: "#e8f0f8", fontFamily: "'DM Mono',monospace" }}>
                          {lot.amount} {lot.unit || asset.commodityUnit} · {fmtPLN2(lotPaid)}
                        </span>
                      </div>
                      {lotPct !== null && (
                        <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: lotPnl >= 0 ? "#00c896" : "#f05060", flexShrink: 0 }}>
                          {lotPct >= 0 ? "+" : ""}{lotPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {(lot.date || lot.note) && (
                      <div style={{ fontSize: 10, color: "#3a4a5e", marginTop: 2, marginLeft: 10 }}>
                        {lot.date && new Date(lot.date).toLocaleDateString("pl-PL")}
                        {lot.note && <span style={{ marginLeft: 6 }}>· {lot.note}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stopka */}
        <div style={{ fontSize: 11, color: "#3a4a5e", padding: "4px 4px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
          <span>{usdPLN ? `1 USD = ${usdPLN.toFixed(4)} PLN (NBP)` : ""}</span>
          <span>
            Źródło: {providerLabel}
            {fromCache && cacheAge !== null && ` (${cacheAge} min temu)`}
          </span>
        </div>

        {asset.note && (
          <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 8, padding: "6px 10px", background: "#0f1520", borderRadius: 8 }}>📝 {asset.note}</div>
        )}
      </div>
    </div>
  );
}

// ─── Formularz jednego zakupu ─────────────────────────────────────────────────
function PurchaseForm({ lot, index, onUpdate, onRemove, canRemove, defaultUnit }) {
  return (
    <div style={{ padding: "12px 12px", background: "#0f1520", borderRadius: 10, border: "1px solid #1e2a38" }}>
      {canRemove && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#5a6a7e" }}>Zakup {index + 1}</div>
          <button onClick={() => onRemove(index)}
            style={{ background: "transparent", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: "pointer", width: 24, height: 24, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Ilość</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} type="number" step="any" placeholder="1"
            value={lot.amount} onChange={e => onUpdate(index, { ...lot, amount: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Jednostka</label>
          <select style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} value={lot.unit || defaultUnit}
            onChange={e => onUpdate(index, { ...lot, unit: e.target.value })} onFocus={focusInp} onBlur={blurInp}>
            {Object.entries(UNIT_LABELS).map(([k, v]) => (
              <option key={k} value={k} style={{ background: "#1a2535" }}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Zapłaciłem łącznie</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} type="number" step="any" placeholder="13 500"
            value={lot.paidTotal} onChange={e => onUpdate(index, { ...lot, paidTotal: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Waluta</label>
          <select style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} value={lot.currency || "PLN"}
            onChange={e => onUpdate(index, { ...lot, currency: e.target.value })} onFocus={focusInp} onBlur={blurInp}>
            {Object.entries(CURRENCY_LABELS).map(([k, v]) => (
              <option key={k} value={k} style={{ background: "#1a2535" }}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Data zakupu (opcjonalnie)</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} type="date" value={lot.date || ""}
            onChange={e => onUpdate(index, { ...lot, date: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Notatka (opcjonalnie)</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} placeholder="np. Mennica Polska" value={lot.note || ""}
            onChange={e => onUpdate(index, { ...lot, note: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
      </div>
    </div>
  );
}

// ─── Modal dodawania/edycji surowca ──────────────────────────────────────────
export function CommodityModal({ asset, onSave, onDelete, onClose }) {
  const isEdit = !!asset;
  const [symbol, setSymbol] = useState(asset?.commoditySymbol || "XAU");
  const [customName, setCustomName] = useState(asset?.commodityCustomName || "");
  const [lots, setLots] = useState(
    asset?.commodityLots?.length > 0
      ? asset.commodityLots
      : [{ amount: "", unit: "oz", paidTotal: "", currency: "PLN", date: "", note: "" }]
  );
  const [noteGlobal, setNoteGlobal] = useState(asset?.note || "");

  const [spotPriceUSD, setSpotPriceUSD] = useState(null);
  const [fxRates, setFxRates] = useState({ USD: 3.95, EUR: 4.27, PLN: 1 });
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [hovSave, setHovSave] = useState(false);
  const [hovDel, setHovDel] = useState(false);
  const [hovClose, setHovClose] = useState(false);

  const commodity = getCommodity(symbol);

  // Pobierz cenę spot i kursy walut po wyborze surowca
  useEffect(() => {
    setLoadingPrice(true);
    setSpotPriceUSD(null);
    async function load() {
      try {
        const [proxyRes, usdPLN, eurPLN] = await Promise.all([
          fetch(`/api/commodity-price?symbols=${symbol}`, { signal: AbortSignal.timeout(10000) }),
          fetchFxRate("USD"),
          fetchFxRate("EUR"),
        ]);
        setFxRates({ USD: usdPLN, EUR: eurPLN, PLN: 1 });
        if (proxyRes.ok) {
          const data = await proxyRes.json();
          const pd = data.prices?.[symbol];
          if (pd?.priceUSD) setSpotPriceUSD(pd.priceUSD);
        }
      } catch {}
      setLoadingPrice(false);
    }
    load();
  }, [symbol]);

  // Przelicz łączną ilość w oz i łączną kwotę zapłaconą w PLN ze wszystkich zakupów
  const totalOz = lots.reduce((s, lot) => s + toOz(lot.amount, lot.unit || "oz"), 0);
  const totalPaidPLN = lots.reduce((s, lot) => {
    const paid = parseFloat(lot.paidTotal) || 0;
    const fx = fxRates[lot.currency || "PLN"] || 1;
    return s + paid * fx;
  }, 0);

  const currentValuePLN = spotPriceUSD && totalOz > 0 ? totalOz * spotPriceUSD * fxRates.USD : null;
  const pnlPLN = currentValuePLN !== null && totalPaidPLN > 0 ? currentValuePLN - totalPaidPLN : null;
  const pnlPct = pnlPLN !== null && totalPaidPLN > 0 ? (pnlPLN / totalPaidPLN) * 100 : null;

  const canSave = totalOz > 0 && totalPaidPLN > 0;

  function addLot() {
    const lastLot = lots[lots.length - 1];
    setLots(l => [...l, { amount: "", unit: lastLot?.unit || "oz", paidTotal: "", currency: lastLot?.currency || "PLN", date: "", note: "" }]);
  }
  function updateLot(i, lot) { setLots(l => l.map((x, j) => j === i ? lot : x)); }
  function removeLot(i) { setLots(l => l.filter((_, j) => j !== i)); }

  function submit() {
    if (!canSave) return;
    const cleanLots = lots.filter(l => parseFloat(l.amount) > 0 && parseFloat(l.paidTotal) > 0);
    const value = currentValuePLN ?? totalPaidPLN;
    onSave({
      id: asset?.id || Date.now(),
      name: customName || commodity.name,
      category: "Surowce",
      value,
      note: noteGlobal,
      isCommodity: true,
      commoditySymbol: symbol,
      commodityCustomName: customName,
      commodityAmount: cleanLots.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
      commodityUnit: cleanLots[0]?.unit || "oz",
      commodityPaidPLN: totalPaidPLN,
      commodityLots: cleanLots,
    });
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>{isEdit ? "Edytuj surowiec" : "Dodaj surowiec"}</div>
          <button onClick={onClose} onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        {/* Wybór surowca */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Surowiec</label>
          <select style={baseInp} value={symbol} onChange={e => setSymbol(e.target.value)} onFocus={focusInp} onBlur={blurInp}>
            {COMMODITIES.map(c => (
              <option key={c.symbol} value={c.symbol} style={{ background: "#1a2535" }}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Cena spot na żywo */}
        <div style={{ background: "#0f1a27", border: `1px solid ${commodity.color}30`, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <div>
              <span style={{ fontSize: 11, color: "#5a6a7e" }}>Cena spot</span>
            </div>
            {loadingPrice && <div style={{ fontSize: 11, color: "#5a6a7e" }}>Pobieranie ceny...</div>}
            {spotPriceUSD && !loadingPrice && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: commodity.color, fontFamily: "'DM Mono', monospace" }}>
                  {fmtUSD(spotPriceUSD)} / oz
                </div>
                <div style={{ fontSize: 11, color: "#5a6a7e" }}>
                  ≈ {fmtPLN2(spotPriceUSD * fxRates.USD)} / oz
                </div>
              </div>
            )}
            {!spotPriceUSD && !loadingPrice && (
              <div style={{ fontSize: 11, color: "#5a4a3e" }}>Nie udało się pobrać ceny na żywo</div>
            )}
          </div>
        </div>

        {/* Nazwa własna */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Nazwa własna (opcjonalnie)</label>
          <input style={baseInp} placeholder={`np. Krugerand 1 oz, Moneta bulionowa...`}
            value={customName} onChange={e => setCustomName(e.target.value)} onFocus={focusInp} onBlur={blurInp} />
        </div>

        {/* Zakupy */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#5a6a7e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            {lots.length === 1 ? "Dane zakupu" : "Zakupy"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lots.map((lot, i) => (
              <PurchaseForm key={i} lot={lot} index={i} onUpdate={updateLot} onRemove={removeLot}
                canRemove={lots.length > 1} defaultUnit="oz" />
            ))}
          </div>
          <button onClick={addLot}
            style={{ marginTop: 8, width: "100%", padding: "8px", borderRadius: 8, border: `1px dashed ${commodity.color}40`, background: "transparent", color: commodity.color, fontSize: 12, cursor: "pointer", fontFamily: "'Sora',sans-serif" }}>
            + Dodaj kolejny zakup
          </button>
        </div>

        {/* Podsumowanie */}
        {canSave && (
          <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Podsumowanie</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Łącznie</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>
                  {totalOz.toFixed(4)} oz
                </div>
                <div style={{ fontSize: 11, color: "#4a5a6e" }}>Zapłacono: {fmtPLN(totalPaidPLN)}</div>
              </div>
              {currentValuePLN !== null && (
                <div>
                  <div style={{ fontSize: 11, color: "#5a7a9e" }}>Aktualna wartość</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: commodity.color, fontFamily: "'DM Mono', monospace" }}>
                    {fmtPLN(currentValuePLN)}
                  </div>
                  {pnlPLN !== null && (
                    <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
                      {pnlPLN >= 0 ? "+" : ""}{fmtPLN(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct?.toFixed(1)}%)
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notatka globalna */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Notatka ogólna (opcjonalnie)</label>
          <input style={baseInp} placeholder="np. fizyczne złoto w sejfie, XTB..."
            value={noteGlobal} onChange={e => setNoteGlobal(e.target.value)} onFocus={focusInp} onBlur={blurInp} />
        </div>

        {/* Przyciski */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={submit} onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)} disabled={!canSave}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 8, border: `2px solid ${commodity.color}`,
              background: hovSave && canSave ? commodity.color + "12" : "transparent",
              color: commodity.color, fontWeight: 700, fontSize: 13, cursor: canSave ? "pointer" : "not-allowed",
              fontFamily: "'Sora', sans-serif", transition: "all .2s", opacity: canSave ? 1 : 0.4,
            }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj do portfela"}
          </button>
          {isEdit && (
            <button onClick={() => { onDelete(asset.id); onClose(); }} onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${hovDel ? "#f05060" : "#f0506040"}`, background: hovDel ? "#f0506018" : "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", transition: "all .15s" }}>
              Usuń
            </button>
          )}
          <button onClick={onClose}
            style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #f0506040", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer" }}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Wiersz surowca na liście aktywów ─────────────────────────────────────────
export function CommodityRow({ asset, commodityPrices, color, onClick }) {
  const [hov, setHov] = useState(false);
  const commodity = getCommodity(asset.commoditySymbol);

  const pd = commodityPrices[asset.commoditySymbol];
  const oz = toOz(asset.commodityAmount, asset.commodityUnit);
  const currentValuePLN = pd?.pricePLN ? oz * pd.pricePLN : asset.value;
  const paidPLN = asset.commodityPaidPLN || asset.value;
  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  const hasLivePrice = !!pd?.priceUSD;
  const fromCache = pd?.fromCache;

  const fmtPLN0 = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);

  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8,
        border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s",
      }}>
      <div style={{ width: 4, borderRadius: 2, background: color, flexShrink: 0, alignSelf: "stretch" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ minWidth: 0, overflow: "hidden", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e8f0f8" }}>{commodity.name}</span>
            {asset.commodityCustomName && (
              <span style={{ fontSize: 12, color: "#8a9bb0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                · {asset.commodityCustomName}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8", flexShrink: 0 }}>
            {fmtPLN0(currentValuePLN)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", whiteSpace: "nowrap" }}>
            {asset.commodityAmount} {asset.commodityUnit}
            {pd?.priceUSD && (
              <span style={{ marginLeft: 4, color: "#5a6a7e" }}>
                @ {fmtUSD(pd.priceUSD)} / oz
              </span>
            )}
            {!hasLivePrice && <span style={{ color: "#3a4a5e", marginLeft: 4 }}>· ładowanie...</span>}
            {hasLivePrice && fromCache && <span style={{ color: "#5a4a3e", marginLeft: 4 }}>· cache</span>}
          </div>
          {hasLivePrice && (
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: "nowrap", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
              {pnlPLN >= 0 ? "+" : ""}{fmtPLN0(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
