// src/StockModal.jsx
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Klucz Twelve Data — używany TYLKO do wyszukiwarki symboli ────────────────
const TWELVE_DATA_KEY = "a681abc9ebc045a39c938d8b058567d9";

// ─── Style ────────────────────────────────────────────────────────────────────
const labelSt = {
  fontSize: 11, color: "#5a6a7e", display: "block",
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em"
};
const baseInp = {
  display: "block", width: "100%", padding: "9px 12px", fontSize: 13,
  borderRadius: 8, background: "#1a2535", border: "1px solid #243040",
  color: "#e8f0f8", fontFamily: "'Sora', sans-serif", outline: "none",
  WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
  boxSizing: "border-box", transition: "border-color .15s, box-shadow .15s",
};
const focusInp = e => { e.target.style.borderColor = "#e8e040"; e.target.style.boxShadow = "0 0 0 3px #e8e04018"; };
const blurInp  = e => { e.target.style.borderColor = "#243040"; e.target.style.boxShadow = "none"; };
const fmtPLN  = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
const fmtPLN2 = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(n);
const fmtCur  = (n, cur) => n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " " + (cur || "");

// ─── Cache kursów NBP ─────────────────────────────────────────────────────────
const fxCache = {};

async function fetchFxRate(currency) {
  if (!currency || currency === "PLN") return 1;
  if (fxCache[currency]) return fxCache[currency];
  const fallback = { USD: 3.95, EUR: 4.27, GBP: 5.0, CHF: 4.4, GBX: 0.049 };
  try {
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency}/last/1/?format=json`);
    if (!res.ok) throw new Error("NBP error");
    const data = await res.json();
    const rate = data.rates?.[0]?.mid;
    if (rate) { fxCache[currency] = rate; return rate; }
  } catch (e) {
    try {
      const res2 = await fetch(`https://api.nbp.pl/api/exchangerates/rates/b/${currency}/last/1/?format=json`);
      if (res2.ok) { const d = await res2.json(); const r = d.rates?.[0]?.mid; if (r) { fxCache[currency] = r; return r; } }
    } catch (e2) {}
  }
  return fallback[currency] || 4.0;
}

// ─── Cache cen w localStorage ─────────────────────────────────────────────────
const STOCK_CACHE_KEY = "pt-stock-cache";
function loadCachedPrices() { try { const r = localStorage.getItem(STOCK_CACHE_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; } }
function saveCachedPrices(p) { try { localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(p)); } catch {} }

// ─── Helpers do transz ────────────────────────────────────────────────────────
export function calcStockFromLots(lots) {
  if (!lots || lots.length === 0) return { totalQty: 0, avgPrice: 0, totalCost: 0 };
  const totalQty = lots.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0);
  const totalCost = lots.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.price) || 0), 0);
  const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
  return { totalQty, avgPrice, totalCost };
}

// ─── Hook: live ceny — przez /api/stock-price proxy ───────────────────────────
export function useStockPrices(assets) {
  const [stockPrices, setStockPrices] = useState(() => {
    const cached = loadCachedPrices();
    const initial = {};
    for (const [sym, data] of Object.entries(cached)) {
      if (data.priceOrig && data.pricePLN) initial[sym] = { ...data, fromCache: true };
    }
    return initial;
  });
  const [stockLastUpdated, setStockLastUpdated] = useState(null);

  const stockAssets = assets.filter(a => a.isStock && a.stockSymbol);
  const symbolKey = stockAssets.map(a => `${a.stockSymbol}:${a.stockExchange}`).join(",");

  const fetchAll = useCallback(async () => {
    if (stockAssets.length === 0) return;
    const symbols = [...new Set(stockAssets.map(a => a.stockSymbol))];
    const exchanges = symbols.map(sym => {
      const asset = stockAssets.find(a => a.stockSymbol === sym);
      return asset?.stockExchange || "XNAS";
    });
    const currencies = [...new Set(stockAssets.map(a => a.stockCurrency).filter(c => c && c !== "PLN"))];
    const fxRates = { PLN: 1 };
    await Promise.all(currencies.map(async cur => { fxRates[cur] = await fetchFxRate(cur); }));

    try {
      const url = `/api/stock-price?symbols=${symbols.join(",")}&exchanges=${exchanges.join(",")}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
      const data = await res.json();
      const newPrices = {};
      for (const sym of symbols) {
        const pd = data.prices?.[sym];
        if (pd?.price) {
          const asset = stockAssets.find(a => a.stockSymbol === sym);
          const currency = pd.currency || asset?.stockCurrency || "PLN";
          const fx = fxRates[currency] || 1;
          newPrices[sym] = { priceOrig: pd.price, pricePLN: pd.price * fx, currency, fx, provider: pd.provider, fromCache: false };
        }
      }
      if (Object.keys(newPrices).length > 0) {
        setStockPrices(prev => { const m = { ...prev, ...newPrices }; saveCachedPrices(m); return m; });
        setStockLastUpdated(new Date());
      }
    } catch (e) {
      console.warn("Stock proxy error:", e);
      try {
        const res = await fetch(`https://api.twelvedata.com/price?symbol=${symbols.join(",")}&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        const newPrices = {};
        if (symbols.length === 1) {
          if (data?.price && !isNaN(parseFloat(data.price))) {
            const a = stockAssets.find(a => a.stockSymbol === symbols[0]);
            const c = a?.stockCurrency || "PLN"; const p = parseFloat(data.price); const fx = fxRates[c] || 1;
            newPrices[symbols[0]] = { priceOrig: p, pricePLN: p * fx, currency: c, fx, provider: "twelvedata", fromCache: false };
          }
        } else {
          for (const sym of symbols) {
            if (data?.[sym]?.price && !isNaN(parseFloat(data[sym].price))) {
              const a = stockAssets.find(a => a.stockSymbol === sym);
              const c = a?.stockCurrency || "PLN"; const p = parseFloat(data[sym].price); const fx = fxRates[c] || 1;
              newPrices[sym] = { priceOrig: p, pricePLN: p * fx, currency: c, fx, provider: "twelvedata", fromCache: false };
            }
          }
        }
        if (Object.keys(newPrices).length > 0) {
          setStockPrices(prev => { const m = { ...prev, ...newPrices }; saveCachedPrices(m); return m; });
          setStockLastUpdated(new Date());
        }
      } catch (e2) { console.warn("Twelve Data fallback failed:", e2); }
    }
  }, [symbolKey]);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 5 * 60 * 1000); return () => clearInterval(iv); }, [fetchAll]);
  return { stockPrices, stockLastUpdated };
}

// ─── Mini Sparkline (SVG) ─────────────────────────────────────────────────────
function Sparkline({ symbol, exchange, width = 220, height = 50 }) {
  const [points, setPoints] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const yahooSuffix = { WSE: ".WA", XWAR: ".WA", GPW: ".WA", XETR: ".DE", XLON: ".L", LSE: ".L", XAMS: ".AS", XPAR: ".PA" };
        const ySym = symbol + (yahooSuffix[exchange] || "");
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=1mo&interval=1d`, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        // To będzie blokowane przez CORS w przeglądarce — fallback poniżej
        if (!res.ok) throw new Error();
        const data = await res.json();
        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => v != null);
        if (closes && closes.length > 1 && !cancelled) setPoints(closes);
      } catch {
        // CORS block expected — próbuj proxy
        try {
          const res2 = await fetch(`/api/stock-chart?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`);
          if (res2.ok) {
            const data2 = await res2.json();
            if (data2.chart && data2.chart.length > 1 && !cancelled) setPoints(data2.chart);
          }
        } catch {}
      }
    }
    load();
    return () => { cancelled = true; };
  }, [symbol, exchange]);

  if (!points || points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const isUp = points[points.length - 1] >= points[0];

  const pathD = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * (height - 4) - 2;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", borderRadius: 8, overflow: "hidden" }}>
      <defs>
        <linearGradient id={`spark-${symbol}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isUp ? "#00c896" : "#f05060"} stopOpacity="0.25" />
          <stop offset="100%" stopColor={isUp ? "#00c896" : "#f05060"} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={`${pathD} L ${width} ${height} L 0 ${height} Z`} fill={`url(#spark-${symbol})`} />
      <path d={pathD} fill="none" stroke={isUp ? "#00c896" : "#f05060"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Panel szczegółów akcji/ETF (wzorowany na BondDetailPanel) ────────────────
export function StockDetailPanel({ stock, stockPrices, onEdit, onDelete, onClose, onMove }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const priceData = stockPrices[stock.stockSymbol];
  const currentPriceOrig = priceData?.priceOrig;
  const fx = priceData?.fx || 1;
  const currency = stock.stockCurrency || "PLN";
  const provider = priceData?.provider;
  const providerLabel = { yahoo: "Yahoo Finance", stooq: "Stooq", twelvedata: "Twelve Data" }[provider] || "—";
  const isFromCache = priceData?.fromCache;

  const totalQty = stock.stockQuantity || 0;
  const avgPrice = stock.stockAvgPrice || 0;
  const paidPLN = stock.stockPaidPLN || totalQty * avgPrice * fx;
  const currentValuePLN = currentPriceOrig ? totalQty * currentPriceOrig * fx : paidPLN;
  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;

  const lots = stock.stockLots || [];
  const hasLots = lots.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: "20px 16px", width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e8f0f8", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: "#e8e040", fontFamily: "'DM Mono', monospace", marginRight: 8 }}>{stock.stockSymbol}</span>
              {stock.stockName || stock.name}
            </div>
            <div style={{ fontSize: 11, color: "#5a6a7e", display: "flex", flexWrap: "wrap", gap: "0 6px" }}>
              <span>{stock.stockExchange}</span><span>·</span><span>{currency}</span><span>·</span><span>{stock.stockType || "Akcje"}</span>
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
                  <button onClick={() => { setMenuOpen(false); onEdit(stock); }}
                    style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    ✏️ Edytuj
                  </button>
                  {onMove && (
                    <button onClick={() => { setMenuOpen(false); onMove(stock); }}
                      style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      💼 Przenieś
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); onDelete(stock.id); onClose(); }}
                    style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: "#f05060", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0506018"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    🗑️ Usuń
                  </button>
                </div>
              )}
            </div>
            <button onClick={onClose}
              style={{ background: "transparent", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: "pointer", width: 30, height: 30, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        </div>

        {/* Sparkline */}
        <div style={{ marginBottom: 12 }}>
          <Sparkline symbol={stock.stockSymbol} exchange={stock.stockExchange} width={468} height={50} />
        </div>

        {/* Wartości — grid 2×2 */}
        <div style={{ background: "#0f1a27", borderRadius: 12, padding: "14px 14px", marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px" }}>
            <div>
              <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Zainwestowano</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono',monospace" }}>{fmtPLN2(paidPLN)}</div>
              <div style={{ fontSize: 10, color: "#3a4a5e" }}>{totalQty} szt. × {fmtCur(avgPrice, currency)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Aktualna wartość</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono',monospace" }}>{fmtPLN2(currentValuePLN)}</div>
              {currentPriceOrig && <div style={{ fontSize: 10, color: "#3a4a5e" }}>{totalQty} szt. × {fmtCur(currentPriceOrig, currency)}</div>}
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Zysk / Strata</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: pnlPLN >= 0 ? "#00c896" : "#f05060", fontFamily: "'DM Mono',monospace" }}>
                {pnlPLN >= 0 ? "+" : ""}{fmtPLN2(pnlPLN)}
              </div>
              <div style={{ fontSize: 11, color: pnlPLN >= 0 ? "#009966" : "#c04050", fontFamily: "'DM Mono',monospace" }}>
                ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 2 }}>Aktualna cena</div>
              {currentPriceOrig ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono',monospace" }}>{fmtCur(currentPriceOrig, currency)}</div>
                  {currency !== "PLN" && <div style={{ fontSize: 10, color: "#3a4a5e" }}>≈ {fmtPLN2(currentPriceOrig * fx)}</div>}
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#3a4a5e" }}>odświeżanie...</div>
              )}
            </div>
          </div>
        </div>

        {/* Transze zakupu */}
        {hasLots && (
          <div style={{ background: "#0f1a27", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#5a6a7e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Transze zakupu</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {lots.map((lot, i) => {
                const lq = parseFloat(lot.quantity) || 0;
                const lp = parseFloat(lot.price) || 0;
                const lCost = lq * lp * fx;
                const lVal = currentPriceOrig ? lq * currentPriceOrig * fx : lCost;
                const lPnl = lVal - lCost;
                const lPct = lCost > 0 ? (lPnl / lCost) * 100 : 0;
                return (
                  <div key={i} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #1e2a38" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#e8e040", flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: "#e8f0f8", fontFamily: "'DM Mono',monospace" }}>{lq} szt. × {fmtCur(lp, currency)}</span>
                      </div>
                      {currentPriceOrig && (
                        <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: lPnl >= 0 ? "#00c896" : "#f05060", flexShrink: 0 }}>
                          {lPnl >= 0 ? "+" : ""}{lPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {lot.date && (
                      <div style={{ fontSize: 10, color: "#3a4a5e", marginTop: 2, marginLeft: 10 }}>
                        {new Date(lot.date).toLocaleDateString("pl-PL")}{lot.note && <span style={{ marginLeft: 6 }}>· {lot.note}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer info */}
        <div style={{ fontSize: 11, color: "#3a4a5e", padding: "4px 4px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
          <span>{currency !== "PLN" && `1 ${currency} = ${fx.toFixed(4)} PLN (NBP)`}</span>
          <span>Źródło: {providerLabel}{isFromCache && " (cache)"}</span>
        </div>

        {stock.note && (
          <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 8, padding: "6px 10px", background: "#0f1520", borderRadius: 8 }}>📝 {stock.note}</div>
        )}
      </div>
    </div>
  );
}

// ─── Wyszukiwarka symboli ─────────────────────────────────────────────────────
const EXCHANGE_PRIORITY = ["WSE", "XETR", "XWAR", "XAMS", "XPAR", "XLON", "XNAS", "XNYS"];

function sortByExchange(results) {
  return [...results].sort((a, b) => {
    const ai = EXCHANGE_PRIORITY.indexOf(a.exchange);
    const bi = EXCHANGE_PRIORITY.indexOf(b.exchange);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function SymbolSearch({ initialValue, onSelect }) {
  const [query, setQuery] = useState(initialValue || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => { document.removeEventListener("mousedown", handleOutside); document.removeEventListener("touchstart", handleOutside); };
  }, []);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q); setOpen(true);
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const searchQ = q.replace(/\.(PL|DE|US|UK|L|WA|AS|PA)$/i, "").trim();
        const res = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(searchQ)}&outputsize=30&apikey=${TWELVE_DATA_KEY}`);
        const data = await res.json();
        const filtered = (data.data || []).filter(r => ["Common Stock", "ETF"].includes(r.instrument_type));
        setResults(sortByExchange(filtered).slice(0, 6));
      } catch (e) { setResults([]); }
      setLoading(false);
    }, 450);
  }

  function handleSelect(item) {
    setQuery(`${item.symbol} — ${item.instrument_name}`);
    setOpen(false); setResults([]);
    onSelect({ symbol: item.symbol, name: item.instrument_name, exchange: item.exchange, currency: item.currency, type: item.instrument_type });
  }

  function exchangeLabel(ex) {
    return { XETR: "Frankfurt (XETRA)", WSE: "GPW Warszawa", XWAR: "GPW Warszawa", XAMS: "Amsterdam", XPAR: "Paryż", XLON: "Londyn", XNAS: "NASDAQ", XNYS: "NYSE" }[ex] || ex;
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input style={baseInp} placeholder="Wpisz nazwę lub ticker, np. IUSQ, Apple, PKN..." value={query}
        onChange={handleInput} onFocus={e => { setOpen(true); focusInp(e); }} onBlur={blurInp} autoComplete="off" />
      {open && (loading || results.length > 0) && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10, zIndex: 300, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {loading && <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>Szukam...</div>}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>Brak wyników. Spróbuj bez końcówki (np. "IUSQ" zamiast "IUSQ.DE")</div>
          )}
          {results.map((item, i) => (
            <div key={i} onClick={() => handleSelect(item)} onTouchEnd={e => { e.preventDefault(); handleSelect(item); }}
              style={{ padding: "10px 14px", cursor: "pointer", borderBottom: i < results.length - 1 ? "1px solid #1e2a38" : "none" }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{item.symbol}</span>
                  <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 8 }}>{item.instrument_name}</span>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: "#5a6a7e", background: "#1e2a38", padding: "2px 6px", borderRadius: 4 }}>{exchangeLabel(item.exchange)}</span>
                  <span style={{ fontSize: 10, color: "#4a8a6e", background: "#0a2018", padding: "2px 6px", borderRadius: 4 }}>{item.currency}</span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 2 }}>{item.instrument_type}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Formularz transzy ────────────────────────────────────────────────────────
function LotForm({ lot, index, currency, onUpdate, onRemove, canRemove }) {
  return (
    <div style={{ padding: "8px 10px", background: "#0f1520", borderRadius: 8, border: "1px solid #1e2a38" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" + (canRemove ? " auto" : ""), gap: 8, alignItems: "end" }}>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Ilość</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} type="number" step="any" placeholder="10"
            value={lot.quantity} onChange={e => onUpdate(index, { ...lot, quantity: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Cena ({currency})</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} type="number" step="any" placeholder="58.30"
            value={lot.price} onChange={e => onUpdate(index, { ...lot, price: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
        {canRemove && (
          <button onClick={() => onRemove(index)}
            style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #f0506030", background: "transparent", color: "#f05060", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 1 }}>×</button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Data (opcjonalnie)</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} type="date" value={lot.date || ""}
            onChange={e => onUpdate(index, { ...lot, date: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
        <div>
          <label style={{ ...labelSt, fontSize: 10 }}>Notatka</label>
          <input style={{ ...baseInp, padding: "7px 10px", fontSize: 12 }} placeholder="np. XTB" value={lot.note || ""}
            onChange={e => onUpdate(index, { ...lot, note: e.target.value })} onFocus={focusInp} onBlur={blurInp} />
        </div>
      </div>
    </div>
  );
}

// ─── Modal dodawania/edycji akcji/ETF ─────────────────────────────────────────
export function StockModal({ stock, onSave, onDelete, onClose }) {
  const isEdit = !!stock;
  const [selected, setSelected] = useState(stock ? {
    symbol: stock.stockSymbol, name: stock.stockName, exchange: stock.stockExchange, currency: stock.stockCurrency, type: stock.stockType,
  } : null);

  const initialLots = stock?.stockLots || [];
  const [mode, setMode] = useState(initialLots.length > 0 ? "lots" : "simple");
  const [quantity, setQuantity] = useState(stock?.stockQuantity?.toString() || "");
  const [avgPrice, setAvgPrice] = useState(stock?.stockAvgPrice?.toString() || "");
  const [lots, setLots] = useState(initialLots.length > 0 ? initialLots : [{ quantity: "", price: "", date: "", note: "" }]);
  const [note, setNote] = useState(stock?.note || "");
  const [currentPrice, setCurrentPrice] = useState(null);
  const [fxRate, setFxRate] = useState(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [priceError, setPriceError] = useState(false);
  const [hovSave, setHovSave] = useState(false);
  const [hovDel, setHovDel] = useState(false);
  const [hovClose, setHovClose] = useState(false);

  useEffect(() => {
    if (!selected?.symbol) return;
    setLoadingPrice(true); setCurrentPrice(null); setPriceError(false);
    async function load() {
      try {
        const exchange = selected.exchange || "XNAS";
        const [proxyRes, fx] = await Promise.all([
          fetch(`/api/stock-price?symbols=${encodeURIComponent(selected.symbol)}&exchanges=${encodeURIComponent(exchange)}`),
          fetchFxRate(selected.currency),
        ]);
        if (proxyRes.ok) {
          const data = await proxyRes.json();
          const pd = data.prices?.[selected.symbol];
          if (pd?.price) { setCurrentPrice(pd.price); setFxRate(fx); setLoadingPrice(false); return; }
        }
        const tdRes = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(selected.symbol)}&apikey=${TWELVE_DATA_KEY}`);
        const tdData = await tdRes.json();
        if (tdData?.price && !isNaN(parseFloat(tdData.price))) setCurrentPrice(parseFloat(tdData.price));
        else setPriceError(true);
        setFxRate(fx);
      } catch (e) { setPriceError(true); }
      setLoadingPrice(false);
    }
    load();
  }, [selected?.symbol, selected?.currency, selected?.exchange]);

  const currency = selected?.currency || "PLN";
  const fx = fxRate || 1;

  let totalQty, totalAvgPrice, totalCostOrig;
  if (mode === "lots") {
    const calc = calcStockFromLots(lots);
    totalQty = calc.totalQty; totalAvgPrice = calc.avgPrice; totalCostOrig = calc.totalCost;
  } else {
    totalQty = parseFloat(String(quantity).replace(",", ".")) || 0;
    totalAvgPrice = parseFloat(String(avgPrice).replace(",", ".")) || 0;
    totalCostOrig = totalQty * totalAvgPrice;
  }

  const paidPLN = totalCostOrig * fx;
  const currentValuePLN = currentPrice && totalQty > 0 ? totalQty * currentPrice * fx : null;
  const pnlPLN = currentValuePLN !== null && paidPLN > 0 ? currentValuePLN - paidPLN : null;
  const pnlPct = pnlPLN !== null && paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : null;

  const canSave = selected && totalQty > 0 && totalAvgPrice > 0;

  function addLot() { setLots(l => [...l, { quantity: "", price: "", date: "", note: "" }]); }
  function updateLot(i, lot) { setLots(l => l.map((x, j) => j === i ? lot : x)); }
  function removeLot(i) { setLots(l => l.filter((_, j) => j !== i)); }

  function submit() {
    if (!canSave) return;
    const value = currentValuePLN ?? paidPLN;
    const cleanLots = mode === "lots" ? lots.filter(l => parseFloat(l.quantity) > 0 && parseFloat(l.price) > 0) : [];
    onSave({
      id: stock?.id || Date.now(), name: selected.name || selected.symbol, category: "Akcje / ETF", value, note, isStock: true,
      stockSymbol: selected.symbol, stockName: selected.name, stockExchange: selected.exchange, stockCurrency: currency,
      stockType: selected.type, stockQuantity: totalQty, stockAvgPrice: totalAvgPrice, stockPaidPLN: paidPLN,
      stockLots: cleanLots.length > 0 ? cleanLots : undefined,
    });
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>{isEdit ? "Edytuj akcje / ETF" : "Dodaj akcje / ETF"}</div>
          <button onClick={onClose} onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelSt}>Wyszukaj akcję lub ETF</label>
          <SymbolSearch initialValue={stock ? `${stock.stockSymbol} — ${stock.stockName}` : ""} onSelect={sel => { setSelected(sel); setCurrentPrice(null); setFxRate(null); setPriceError(false); }} />
          <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>Wpisz ticker bez końcówki giełdy, np. "IUSQ" zamiast "IUSQ.DE"</div>
        </div>

        {selected && (
          <div style={{ background: "#0f1a27", border: "1px solid #1e3040", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{selected.symbol}</span>
                <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 8 }}>{selected.name}</span>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <span style={{ fontSize: 11, color: "#5a6a7e", background: "#1e2a38", padding: "2px 8px", borderRadius: 4 }}>{selected.exchange}</span>
                <span style={{ fontSize: 11, color: "#4a8a6e", background: "#0a2018", padding: "2px 8px", borderRadius: 4 }}>{currency}</span>
              </div>
            </div>
            {loadingPrice && <div style={{ fontSize: 11, color: "#5a6a7e", marginTop: 6 }}>Pobieram aktualną cenę...</div>}
            {currentPrice && !loadingPrice && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#8a9bb0" }}>
                Aktualna cena: <span style={{ color: "#e8e040", fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{fmtCur(currentPrice, currency)}</span>
                {currency !== "PLN" && fxRate && <span style={{ marginLeft: 8, color: "#5a6a7e" }}>≈ {fmtPLN2(currentPrice * fxRate)}</span>}
              </div>
            )}
            {priceError && !loadingPrice && <div style={{ fontSize: 11, color: "#f05060", marginTop: 6 }}>Nie udało się pobrać ceny. Cena zaktualizuje się później.</div>}
          </div>
        )}

        {selected && (
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            <button onClick={() => setMode("simple")}
              style={{ flex: 1, padding: "7px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "'Sora',sans-serif", border: `1px solid ${mode === "simple" ? "#e8e040" : "#243040"}`, background: mode === "simple" ? "#e8e04010" : "transparent", color: mode === "simple" ? "#e8e040" : "#5a6a7e" }}>
              Szybko (średnia cena)
            </button>
            <button onClick={() => setMode("lots")}
              style={{ flex: 1, padding: "7px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "'Sora',sans-serif", border: `1px solid ${mode === "lots" ? "#e8e040" : "#243040"}`, background: mode === "lots" ? "#e8e04010" : "transparent", color: mode === "lots" ? "#e8e040" : "#5a6a7e" }}>
              Transze (historia zakupów)
            </button>
          </div>
        )}

        {selected && mode === "simple" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelSt}>Ilość jednostek</label>
              <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any" placeholder="np. 10" value={quantity} onChange={e => setQuantity(e.target.value)} onFocus={focusInp} onBlur={blurInp} />
            </div>
            <div>
              <label style={labelSt}>Średnia cena zakupu ({currency})</label>
              <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any" placeholder="z XTB / brokera" value={avgPrice} onChange={e => setAvgPrice(e.target.value)} onFocus={focusInp} onBlur={blurInp} onKeyDown={e => e.key === "Enter" && submit()} />
              <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>XTB → pozycja → "Średnia cena"</div>
            </div>
          </div>
        )}

        {selected && mode === "lots" && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lots.map((lot, i) => <LotForm key={i} lot={lot} index={i} currency={currency} onUpdate={updateLot} onRemove={removeLot} canRemove={lots.length > 1} />)}
            </div>
            <button onClick={addLot}
              style={{ marginTop: 8, width: "100%", padding: "8px", borderRadius: 8, border: "1px dashed #e8e04040", background: "transparent", color: "#e8e040", fontSize: 12, cursor: "pointer", fontFamily: "'Sora',sans-serif" }}>
              + Dodaj transzę
            </button>
          </div>
        )}

        {selected && totalQty > 0 && totalAvgPrice > 0 && (
          <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Podsumowanie</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zapłacono łącznie</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(paidPLN)}</div>
                <div style={{ fontSize: 11, color: "#4a5a6e" }}>{totalQty} × {fmtCur(totalAvgPrice, currency)}</div>
              </div>
              {currentValuePLN !== null && (
                <div>
                  <div style={{ fontSize: 11, color: "#5a7a9e" }}>Aktualna wartość</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(currentValuePLN)}</div>
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

        {selected && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Notatka (opcjonalnie)</label>
            <input style={baseInp} placeholder="np. XTB, zakup marzec 2024..." value={note} onChange={e => setNote(e.target.value)} onFocus={focusInp} onBlur={blurInp} />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={submit} onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)} disabled={!canSave}
            style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "2px solid #e8e040", background: hovSave && canSave ? "#e8e04012" : "transparent", color: "#e8e040", fontWeight: 700, fontSize: 13, cursor: canSave ? "pointer" : "not-allowed", fontFamily: "'Sora', sans-serif", transition: "all .2s", opacity: canSave ? 1 : 0.4 }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj do portfela"}
          </button>
          {isEdit && (
            <button onClick={() => { onDelete(stock.id); onClose(); }} onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
              style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${hovDel ? "#f05060" : "#f0506040"}`, background: hovDel ? "#f0506018" : "transparent", color: "#f05060", fontSize: 13, cursor: "pointer", transition: "all .15s" }}>Usuń</button>
          )}
          <button onClick={onClose}
            style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #f0506040", background: "transparent", color: "#f05060", fontSize: 13, cursor: "pointer" }}>Anuluj</button>
        </div>
      </div>
    </div>
  );
}

// ─── Wiersz akcji/ETF ─────────────────────────────────────────────────────────
export function StockRow({ stock, stockPrices, color, onClick }) {
  const [hov, setHov] = useState(false);
  const priceData = stockPrices[stock.stockSymbol];
  const currentValuePLN = priceData ? stock.stockQuantity * priceData.pricePLN : stock.value;
  const paidPLN = stock.stockPaidPLN || stock.value;
  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  const hasLivePrice = !!priceData;
  const isFromCache = priceData?.fromCache;
  const providerBadge = priceData?.provider ? { yahoo: "Y", stooq: "S", twelvedata: "T" }[priceData.provider] || "" : "";
  const fmtPLN0 = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);

  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8, border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s" }}>
      <div style={{ width: 4, borderRadius: 2, background: color, flexShrink: 0, alignSelf: "stretch" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{stock.stockSymbol}</span>
            <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stock.stockName || stock.name}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8", flexShrink: 0 }}>{fmtPLN0(currentValuePLN)}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", whiteSpace: "nowrap" }}>
            {stock.stockQuantity} szt.
            {priceData && <span style={{ marginLeft: 4, color: "#5a6a7e" }}>@ {priceData.priceOrig.toFixed(2)} {stock.stockCurrency}</span>}
            {!hasLivePrice && <span style={{ color: "#3a4a5e", marginLeft: 4 }}>• odświeżanie...</span>}
            {isFromCache && <span style={{ color: "#5a4a3e", marginLeft: 4 }}>• cache</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {hasLivePrice && (
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: "nowrap", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
                {pnlPLN >= 0 ? "+" : ""}{fmtPLN0(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
              </div>
            )}
            {providerBadge && !isFromCache && (
              <span style={{ fontSize: 9, color: "#3a4a5e", background: "#0f1520", padding: "1px 4px", borderRadius: 3, fontFamily: "'DM Mono', monospace" }}>{providerBadge}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
