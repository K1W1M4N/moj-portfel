// src/StockModal.jsx
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Proxy URL — omija CORS i limity Twelve Data ─────────────────────────────
const PROXY_BASE = "/api/stock-price";

// ─── Style helpers ────────────────────────────────────────────────────────────
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

export async function fetchFxRate(currency) {
  if (!currency || currency === "PLN") return 1;
  if (fxCache[currency]) return fxCache[currency];
  const fallback = { USD: 3.95, EUR: 4.27, GBP: 5.0, CHF: 4.4, GBX: 0.049 };
  try {
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency}/last/1/?format=json`);
    if (!res.ok) throw new Error("NBP A error");
    const data = await res.json();
    const rate = data.rates?.[0]?.mid;
    if (rate) { fxCache[currency] = rate; return rate; }
  } catch {
    try {
      const res2 = await fetch(`https://api.nbp.pl/api/exchangerates/rates/b/${currency}/last/1/?format=json`);
      if (res2.ok) {
        const data2 = await res2.json();
        const rate2 = data2.rates?.[0]?.mid;
        if (rate2) { fxCache[currency] = rate2; return rate2; }
      }
    } catch {}
  }
  return fallback[currency] || 4.0;
}

// ─── Fetch przez proxy z retry ────────────────────────────────────────────────
async function fetchViaProxy(symbols, exchanges = [], retries = 2) {
  const symStr = Array.isArray(symbols) ? symbols.join(",") : symbols;
  const exchStr = Array.isArray(exchanges) ? exchanges.join(",") : (exchanges || "");
  const url = `${PROXY_BASE}?symbols=${encodeURIComponent(symStr)}${exchStr ? `&exchanges=${encodeURIComponent(exchStr)}` : ""}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data;
    } catch (e) {
      if (attempt === retries) throw e;
    }
  }
}

// ─── Klucz cache localStorage dla cen akcji ──────────────────────────────────
const PRICE_CACHE_KEY = "pt-stock-cache";

function loadPriceCache() {
  try { return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || "{}"); } catch { return {}; }
}
function savePriceCache(cache) {
  try { localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// ─── Hook: live ceny dla aktywów giełdowych ───────────────────────────────────
export function useStockPrices(assets) {
  const [stockPrices, setStockPrices] = useState(() => loadPriceCache());
  const [stockLastUpdated, setStockLastUpdated] = useState(null);

  const stockAssets = assets.filter(a => a.isStock && a.stockSymbol);
  const symbolKey = stockAssets.map(a => `${a.stockSymbol}:${a.stockExchange || ""}`).join(",");

  const fetchAll = useCallback(async () => {
    if (stockAssets.length === 0) return;
    const unique = [...new Map(stockAssets.map(a => [a.stockSymbol, a])).values()];
    const symbols = unique.map(a => a.stockSymbol);
    const exchanges = unique.map(a => a.stockExchange || "");

    try {
      const data = await fetchViaProxy(symbols, exchanges);

      // Kursy walut z NBP — jeden request na walutę
      const currencies = [...new Set(unique.map(a => a.stockCurrency).filter(c => c && c !== "PLN"))];
      const fxRates = { PLN: 1 };
      await Promise.all(currencies.map(async cur => { fxRates[cur] = await fetchFxRate(cur); }));

      const newPrices = {};

      if (symbols.length === 1) {
        // Płaska odpowiedź: { price: "123.45" }
        const priceVal = data?.prices?.[symbols[0]]?.price ?? data?.price;
        if (priceVal && !isNaN(parseFloat(priceVal))) {
          const asset = unique[0];
          const currency = asset?.stockCurrency || "PLN";
          const priceOrig = parseFloat(priceVal);
          const fx = fxRates[currency] || 1;
          newPrices[symbols[0]] = { priceOrig, pricePLN: priceOrig * fx, currency, fx, ts: Date.now() };
        }
      } else {
        // Zagnieżdżona: { SYMBOL: { price: "..." } }
        for (const sym of symbols) {
          const priceVal = data?.prices?.[sym]?.price ?? data?.[sym]?.price;
          if (priceVal && !isNaN(parseFloat(priceVal))) {
            const asset = unique.find(a => a.stockSymbol === sym);
            const currency = asset?.stockCurrency || "PLN";
            const priceOrig = parseFloat(priceVal);
            const fx = fxRates[currency] || 1;
            newPrices[sym] = { priceOrig, pricePLN: priceOrig * fx, currency, fx, ts: Date.now() };
          }
        }
      }

      if (Object.keys(newPrices).length > 0) {
        setStockPrices(prev => {
          const merged = { ...prev, ...newPrices };
          savePriceCache(merged);
          return merged;
        });
        setStockLastUpdated(new Date());
      }
    } catch (e) {
      console.warn("Stock proxy error:", e);
      // Fallback — zostaw ostatnie zapisane ceny (już są w state z loadPriceCache)
    }
  }, [symbolKey]); // eslint-disable-line

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return { stockPrices, stockLastUpdated };
}

// ─── Wyszukiwarka symboli (przez Twelve Data symbol_search — nie jest ograniczona limitem cen) ──
const EXCHANGE_PRIORITY = ["WSE", "XETR", "XWAR", "XAMS", "XPAR", "XLON", "XNAS", "XNYS"];
const TWELVE_DATA_KEY = "a681abc9ebc045a39c938d8b058567d9";

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

function exchangeLabel(exchange) {
  const map = {
    XETR: "Frankfurt (XETRA)", WSE: "GPW Warszawa", XWAR: "GPW Warszawa",
    XAMS: "Amsterdam", XPAR: "Paryż", XLON: "Londyn", XNAS: "NASDAQ", XNYS: "NYSE",
  };
  return map[exchange] || exchange;
}

function SymbolSearch({ initialValue, onSelect }) {
  const [query, setQuery] = useState(initialValue || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    setOpen(true);
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        // Auto-strip końcówki giełdy (np. IUSQ.DE → IUSQ)
        const cleanQ = q.replace(/\.[A-Z]{1,4}$/, "");
        const res = await fetch(
          `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(cleanQ)}&outputsize=30&apikey=${TWELVE_DATA_KEY}`
        );
        const data = await res.json();
        const filtered = (data.data || []).filter(r => ["Common Stock", "ETF"].includes(r.instrument_type));
        setResults(sortByExchange(filtered).slice(0, 6));
      } catch {
        setResults([]);
      }
      setLoading(false);
    }, 450);
  }

  function handleSelect(item) {
    setQuery(`${item.symbol} — ${item.instrument_name}`);
    setOpen(false);
    setResults([]);
    onSelect({
      symbol: item.symbol,
      name: item.instrument_name,
      exchange: item.exchange,
      currency: item.currency,
      type: item.instrument_type,
    });
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        style={baseInp}
        placeholder="Wpisz nazwę lub ticker, np. IUSQ, Apple, PKN..."
        value={query}
        onChange={handleInput}
        onFocus={e => { setOpen(true); focusInp(e); }}
        onBlur={blurInp}
        autoComplete="off"
      />
      {open && (loading || results.length > 0 || query.length >= 2) && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10,
          zIndex: 300, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          {loading && <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>Szukam...</div>}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#5a6a7e" }}>
              Brak wyników. Spróbuj wpisać sam ticker bez końcówki (np. "IUSQ" zamiast "IUSQ.DE")
            </div>
          )}
          {results.map((item, i) => (
            <div key={i}
              onClick={() => handleSelect(item)}
              onTouchEnd={e => { e.preventDefault(); handleSelect(item); }}
              style={{
                padding: "10px 14px", cursor: "pointer",
                borderBottom: i < results.length - 1 ? "1px solid #1e2a38" : "none",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
                    {item.symbol}
                  </span>
                  <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 8 }}>{item.instrument_name}</span>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: "#5a6a7e", background: "#1e2a38", padding: "2px 6px", borderRadius: 4 }}>
                    {exchangeLabel(item.exchange)}
                  </span>
                  <span style={{ fontSize: 10, color: "#4a8a6e", background: "#0a2018", padding: "2px 6px", borderRadius: 4 }}>
                    {item.currency}
                  </span>
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

// ─── Mini sparkline SVG ───────────────────────────────────────────────────────
function Sparkline({ paid, current, color }) {
  if (!paid || !current) return null;
  const w = 80, h = 28;
  const points = [paid, paid * 0.98, paid * 1.01, paid * 0.995, paid * 1.015, current];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Panel szczegółów akcji/ETF ───────────────────────────────────────────────
export function StockDetailPanel({ stock, stockPrices, onEdit, onDelete, onClose, onMove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const priceData = stockPrices[stock.stockSymbol];
  const currentValuePLN = priceData
    ? stock.stockQuantity * priceData.pricePLN
    : stock.value;

  // Koszt zakupu — obsługa wszystkich trybów zapisu
  let paidPLN = stock.stockPaidPLN || 0;
  if (!paidPLN && stock.stockTranches?.length) {
    paidPLN = stock.stockTranches.reduce((s, t) => s + (t.totalPLN || 0), 0);
  }
  if (!paidPLN) paidPLN = stock.value;

  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  const pnlColor = pnlPLN >= 0 ? "#00c896" : "#f05060";
  const hasLive = !!priceData;

  const cacheAge = priceData?.ts ? Math.round((Date.now() - priceData.ts) / 60000) : null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16
    }}>
      <div style={{
        background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16,
        padding: 28, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto"
      }}>
        {/* Nagłówek */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
              {stock.stockSymbol}
            </div>
            <div style={{ fontSize: 13, color: "#8a9bb0", marginTop: 2 }}>{stock.stockName || stock.name}</div>
            <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
              <span style={{ fontSize: 10, color: "#5a6a7e", background: "#1e2a38", padding: "2px 8px", borderRadius: 4 }}>
                {stock.stockExchange}
              </span>
              <span style={{ fontSize: 10, color: "#4a8a6e", background: "#0a2018", padding: "2px 8px", borderRadius: 4 }}>
                {stock.stockCurrency}
              </span>
              {stock.stockType && (
                <span style={{ fontSize: 10, color: "#4a6a8e", background: "#0a1828", padding: "2px 8px", borderRadius: 4 }}>
                  {stock.stockType}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* ··· menu */}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button onClick={() => setMenuOpen(o => !o)}
                style={{ background: menuOpen ? "#1e2a38" : "transparent", border: `1px solid ${menuOpen ? "#2a3a50" : "#1e2a38"}`, borderRadius: 8, color: "#8a9bb0", cursor: "pointer", width: 32, height: 32, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ···
              </button>
              {menuOpen && (
                <div style={{ position: "absolute", top: 38, right: 0, background: "#161d28", border: "1px solid #2a3a50", borderRadius: 10, padding: "4px", minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 10 }}>
                  {[
                    { label: "Edytuj", action: () => { setMenuOpen(false); onEdit(stock); } },
                    { label: "Przenieś", action: () => { setMenuOpen(false); onMove?.(stock); }, hidden: !onMove },
                    { label: "Usuń", action: () => { setMenuOpen(false); onDelete(stock.id); }, danger: true },
                  ].filter(i => !i.hidden).map((item, i) => (
                    <button key={i} onClick={item.action}
                      style={{ display: "block", width: "100%", padding: "9px 14px", background: "transparent", border: "none", color: item.danger ? "#f05060" : "#e8f0f8", fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6, fontFamily: "'Sora',sans-serif" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2a38"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Zamknij */}
            <button onClick={onClose}
              style={{ background: "transparent", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f0506018"; e.currentTarget.style.borderColor = "#f05060"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "#f0506030"; }}>
              ×
            </button>
          </div>
        </div>

        {/* Wartość główna */}
        <div style={{ background: "#0f1a27", border: `1px solid ${pnlColor}30`, borderRadius: 14, padding: "18px 20px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: "#5a7a9e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                Aktualna wartość
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>
                {fmtPLN(currentValuePLN)}
              </div>
              {hasLive && priceData && (
                <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 3 }}>
                  {priceData.priceOrig.toFixed(4)} {stock.stockCurrency}
                  {stock.stockCurrency !== "PLN" && (
                    <span style={{ marginLeft: 6, color: "#5a6a7e" }}>
                      × {priceData.fx.toFixed(4)} PLN/
                      {stock.stockCurrency}
                    </span>
                  )}
                </div>
              )}
              {!hasLive && (
                <div style={{ fontSize: 11, color: "#3a4a5e", marginTop: 3 }}>odświeżanie...</div>
              )}
            </div>
            <Sparkline paid={paidPLN} current={currentValuePLN} color={pnlColor} />
          </div>

          {/* P&L */}
          <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zainwestowano</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#8a9bb0", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(paidPLN)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zysk / strata</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: pnlColor, fontFamily: "'DM Mono', monospace" }}>
                {pnlPLN >= 0 ? "+" : ""}{fmtPLN(pnlPLN)}
                <span style={{ fontSize: 12, marginLeft: 6 }}>({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Szczegóły pozycji */}
        <div style={{ background: "#0f1a27", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#5a7a9e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Szczegóły pozycji</div>

          <Row label="Ilość" value={`${stock.stockQuantity} szt.`} />

          {/* Transze — lista zakupów */}
          {stock.stockTranches?.length > 0 ? (
            <div>
              <div style={{ fontSize: 11, color: "#5a6a7e", marginTop: 8, marginBottom: 4 }}>Transze zakupu</div>
              {stock.stockTranches.map((t, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8a9bb0", paddingBottom: 3 }}>
                  <span>{t.qty} szt.</span>
                  <span style={{ fontFamily: "'DM Mono', monospace" }}>{fmtPLN(t.totalPLN)}</span>
                </div>
              ))}
            </div>
          ) : (
            stock.stockAvgPrice > 0 && (
              <Row label={`Śr. cena zakupu (${stock.stockCurrency})`} value={fmtCur(stock.stockAvgPrice, stock.stockCurrency)} />
            )
          )}

          {stock.note && <Row label="Notatka" value={stock.note} />}

          {cacheAge !== null && (
            <div style={{ fontSize: 10, color: "#3a4a5e", marginTop: 8 }}>
              Cena z {cacheAge < 1 ? "chwilę temu" : `${cacheAge} min temu`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 7, borderBottom: "1px solid #1a2535", marginBottom: 7 }}>
      <span style={{ fontSize: 11, color: "#5a7a9e" }}>{label}</span>
      <span style={{ fontSize: 13, color: "#e8f0f8", fontFamily: "'DM Mono', monospace", textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

// ─── Modal dodawania/edycji akcji/ETF ─────────────────────────────────────────
export function StockModal({ stock, onSave, onDelete, onClose }) {
  const isEdit = !!stock;

  // Tryb wprowadzania danych
  const [mode, setMode] = useState(() => {
    if (!stock) return "szybko";
    if (stock.stockTranches?.length) return "transze";
    if (stock.stockBrokerValue != null) return "broker";
    return "szybko";
  });

  const [selected, setSelected] = useState(stock ? {
    symbol: stock.stockSymbol,
    name: stock.stockName,
    exchange: stock.stockExchange,
    currency: stock.stockCurrency,
    type: stock.stockType,
  } : null);

  // Tryb Szybko
  const [quantity, setQuantity]  = useState(stock?.stockQuantity?.toString() || "");
  const [avgPrice, setAvgPrice]  = useState(stock?.stockAvgPrice?.toString() || "");

  // Tryb Transze
  const [tranches, setTranches] = useState(() => {
    if (stock?.stockTranches?.length) return stock.stockTranches.map(t => ({ qty: t.qty.toString(), totalPLN: t.totalPLN.toString() }));
    return [{ qty: "", totalPLN: "" }];
  });

  // Tryb Z brokera
  const [brokerValue, setBrokerValue]  = useState(stock?.stockBrokerValue?.toString() || "");
  const [brokerPnl, setBrokerPnl]      = useState(stock?.stockBrokerPnl?.toString() || "");

  const [note, setNote] = useState(stock?.note || "");

  // Live cena
  const [currentPrice, setCurrentPrice] = useState(null);
  const [fxRate, setFxRate]     = useState(null);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [priceError, setPriceError]     = useState(false);

  const [hovSave, setHovSave]   = useState(false);
  const [hovDel, setHovDel]     = useState(false);
  const [hovClose, setHovClose] = useState(false);

  // Pobierz cenę po wyborze symbolu
  useEffect(() => {
    if (!selected?.symbol) return;
    setLoadingPrice(true);
    setCurrentPrice(null);
    setPriceError(false);
    let cancelled = false;

    async function load() {
      try {
        const [priceData, fx] = await Promise.all([
          fetchViaProxy([selected.symbol], [selected.exchange || ""]),
          fetchFxRate(selected.currency),
        ]);
        if (cancelled) return;
        const priceVal = priceData?.prices?.[selected.symbol]?.price ?? priceData?.price;
        if (priceVal && !isNaN(parseFloat(priceVal))) {
          setCurrentPrice(parseFloat(priceVal));
        } else {
          setPriceError(true);
        }
        setFxRate(fx);
      } catch {
        if (!cancelled) setPriceError(true);
      }
      if (!cancelled) setLoadingPrice(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selected?.symbol, selected?.exchange, selected?.currency]);

  const currency = selected?.currency || "PLN";
  const fx = fxRate || 1;

  // Obliczenia per tryb
  const calcSzybko = () => {
    const qty = parseFloat(String(quantity).replace(",", ".")) || 0;
    const avg = parseFloat(String(avgPrice).replace(",", ".")) || 0;
    const paidPLN = qty > 0 && avg > 0 ? qty * avg * fx : 0;
    const currentValuePLN = currentPrice && qty > 0 ? qty * currentPrice * fx : null;
    return { qty, avg, paidPLN, currentValuePLN };
  };

  const calcTranches = () => {
    const parsed = tranches.map(t => ({
      qty:      parseFloat(String(t.qty).replace(",", ".")) || 0,
      totalPLN: parseFloat(String(t.totalPLN).replace(",", ".")) || 0,
    })).filter(t => t.qty > 0 && t.totalPLN > 0);
    const totalQty  = parsed.reduce((s, t) => s + t.qty, 0);
    const totalPaid = parsed.reduce((s, t) => s + t.totalPLN, 0);
    const currentValuePLN = currentPrice && totalQty > 0 ? totalQty * currentPrice * fx : null;
    return { parsed, totalQty, totalPaid, currentValuePLN };
  };

  const calcBroker = () => {
    const val = parseFloat(String(brokerValue).replace(",", ".")) || 0;
    const pnl = parseFloat(String(brokerPnl).replace(",", ".")) || 0;
    const invested = val - pnl; // wartość aktualna − P&L = zainwestowano
    return { val, pnl, invested };
  };

  // Czy można zapisać?
  const canSave = (() => {
    if (!selected) return false;
    if (mode === "szybko") {
      const { qty, avg } = calcSzybko();
      return qty > 0 && avg > 0;
    }
    if (mode === "transze") {
      const { parsed } = calcTranches();
      return parsed.length > 0;
    }
    if (mode === "broker") {
      const { val } = calcBroker();
      return val > 0;
    }
    return false;
  })();

  function submit() {
    if (!canSave) return;

    let asset = {
      id: stock?.id || Date.now(),
      name: selected.name || selected.symbol,
      category: "Akcje / ETF",
      note,
      isStock: true,
      stockSymbol: selected.symbol,
      stockName: selected.name,
      stockExchange: selected.exchange,
      stockCurrency: currency,
      stockType: selected.type,
    };

    if (mode === "szybko") {
      const { qty, avg, paidPLN, currentValuePLN } = calcSzybko();
      asset = { ...asset,
        value: currentValuePLN ?? paidPLN,
        stockQuantity: qty,
        stockAvgPrice: avg,
        stockPaidPLN: paidPLN,
      };
    } else if (mode === "transze") {
      const { parsed, totalQty, totalPaid, currentValuePLN } = calcTranches();
      asset = { ...asset,
        value: currentValuePLN ?? totalPaid,
        stockQuantity: totalQty,
        stockPaidPLN: totalPaid,
        stockTranches: parsed,
      };
    } else if (mode === "broker") {
      const { val, pnl, invested } = calcBroker();
      asset = { ...asset,
        value: val,
        stockQuantity: stock?.stockQuantity || 0,
        stockPaidPLN: invested,
        stockBrokerValue: val,
        stockBrokerPnl: pnl,
      };
    }

    onSave(asset);
    onClose();
  }

  const MODES = [
    { id: "szybko",  label: "Szybko" },
    { id: "transze", label: "Transze" },
    { id: "broker",  label: "Z brokera" },
  ];

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div style={{ background: "#161d28", border: "1px solid #2a3a50", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Nagłówek */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e8f0f8" }}>
            {isEdit ? "Edytuj akcje / ETF" : "Dodaj akcje / ETF"}
          </div>
          <button onClick={onClose}
            onMouseEnter={() => setHovClose(true)} onMouseLeave={() => setHovClose(false)}
            style={{ background: hovClose ? "#f0506018" : "#161d28", border: `1px solid ${hovClose ? "#f05060" : "#f0506030"}`, borderRadius: 6, color: "#f05060", cursor: "pointer", fontSize: 18, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
            ×
          </button>
        </div>

        {/* Wyszukiwarka */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelSt}>Wyszukaj akcję lub ETF</label>
          <SymbolSearch
            initialValue={stock ? `${stock.stockSymbol} — ${stock.stockName}` : ""}
            onSelect={sel => { setSelected(sel); setCurrentPrice(null); setFxRate(null); setPriceError(false); }}
          />
          <div style={{ fontSize: 11, color: "#4a5a6e", marginTop: 4 }}>
            Wpisz ticker bez końcówki giełdy, np. "IUSQ" lub "NVDA"
          </div>
        </div>

        {/* Wybrany instrument */}
        {selected && (
          <div style={{ background: "#0f1a27", border: "1px solid #1e3040", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
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
                Aktualna cena:{" "}
                <span style={{ color: "#e8e040", fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                  {fmtCur(currentPrice, currency)}
                </span>
                {currency !== "PLN" && fxRate && (
                  <span style={{ marginLeft: 8, color: "#5a6a7e" }}>≈ {fmtPLN2(currentPrice * fxRate)}</span>
                )}
              </div>
            )}
            {priceError && !loadingPrice && (
              <div style={{ fontSize: 11, color: "#f05060", marginTop: 6 }}>
                Nie udało się pobrać ceny. Możesz dodać aktywo — cena zaktualizuje się później.
              </div>
            )}
          </div>
        )}

        {/* Wybór trybu */}
        {selected && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {MODES.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: `1px solid ${mode === m.id ? "#e8e040" : "#243040"}`,
                    background: mode === m.id ? "#e8e04015" : "#1a2535",
                    color: mode === m.id ? "#e8e040" : "#5a6a7e",
                    fontSize: 12, fontWeight: mode === m.id ? 600 : 400, cursor: "pointer",
                    fontFamily: "'Sora', sans-serif", transition: "all .15s",
                  }}>
                  {m.label}
                </button>
              ))}
            </div>

            {/* ── Tryb Szybko ── */}
            {mode === "szybko" && (() => {
              const { qty, avg, paidPLN, currentValuePLN } = calcSzybko();
              const pnlPLN = currentValuePLN !== null && paidPLN > 0 ? currentValuePLN - paidPLN : null;
              const pnlPct = pnlPLN !== null && paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : null;
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={labelSt}>Ilość jednostek</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="np. 10 lub 5.234"
                        value={quantity} onChange={e => setQuantity(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp} />
                    </div>
                    <div>
                      <label style={labelSt}>Śr. cena zakupu ({currency})</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="z XTB → pozycja → Śr. cena"
                        value={avgPrice} onChange={e => setAvgPrice(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp}
                        onKeyDown={e => e.key === "Enter" && submit()} />
                    </div>
                  </div>
                  {qty > 0 && avg > 0 && (
                    <Summary
                      paid={paidPLN}
                      current={currentValuePLN}
                      pnl={pnlPLN}
                      pnlPct={pnlPct}
                      sub={`${qty} × ${fmtCur(avg, currency)}`}
                    />
                  )}
                </>
              );
            })()}

            {/* ── Tryb Transze ── */}
            {mode === "transze" && (() => {
              const { parsed, totalQty, totalPaid, currentValuePLN } = calcTranches();
              const pnlPLN = currentValuePLN !== null && totalPaid > 0 ? currentValuePLN - totalPaid : null;
              const pnlPct = pnlPLN !== null && totalPaid > 0 ? (pnlPLN / totalPaid) * 100 : null;
              return (
                <>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 6, marginBottom: 6 }}>
                      <span style={{ ...labelSt, marginBottom: 0 }}>Ilość (szt.)</span>
                      <span style={{ ...labelSt, marginBottom: 0 }}>Zapłacono łącznie (PLN)</span>
                      <span />
                    </div>
                    {tranches.map((t, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 6, marginBottom: 6 }}>
                        <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                          placeholder="np. 5.5"
                          value={t.qty}
                          onChange={e => setTranches(ts => ts.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                          onFocus={focusInp} onBlur={blurInp} />
                        <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                          placeholder="np. 1350"
                          value={t.totalPLN}
                          onChange={e => setTranches(ts => ts.map((x, j) => j === i ? { ...x, totalPLN: e.target.value } : x))}
                          onFocus={focusInp} onBlur={blurInp} />
                        <button onClick={() => setTranches(ts => ts.filter((_, j) => j !== i))}
                          disabled={tranches.length === 1}
                          style={{ height: 36, alignSelf: "center", background: "transparent", border: "1px solid #f0506030", borderRadius: 6, color: "#f05060", cursor: tranches.length === 1 ? "not-allowed" : "pointer", opacity: tranches.length === 1 ? 0.3 : 1, fontSize: 14 }}>
                          ×
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setTranches(ts => [...ts, { qty: "", totalPLN: "" }])}
                      style={{ fontSize: 12, color: "#e8e040", background: "transparent", border: "1px dashed #e8e04040", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontFamily: "'Sora', sans-serif", marginTop: 2 }}>
                      + Dodaj transzę
                    </button>
                  </div>
                  {parsed.length > 0 && (
                    <Summary
                      paid={totalPaid}
                      current={currentValuePLN}
                      pnl={pnlPLN}
                      pnlPct={pnlPct}
                      sub={`${totalQty} szt. · ${parsed.length} ${parsed.length === 1 ? "transza" : parsed.length < 5 ? "transze" : "transz"}`}
                    />
                  )}
                </>
              );
            })()}

            {/* ── Tryb Z brokera ── */}
            {mode === "broker" && (() => {
              const { val, pnl, invested } = calcBroker();
              return (
                <>
                  <div style={{ fontSize: 11, color: "#5a6a7e", marginBottom: 10, lineHeight: 1.5 }}>
                    Przepisz wartości wprost z XTB: otwórz pozycję i wpisz aktualną wartość i P&L.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={labelSt}>Aktualna wartość (PLN)</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="z XTB → wartość"
                        value={brokerValue} onChange={e => setBrokerValue(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp} />
                    </div>
                    <div>
                      <label style={labelSt}>P&L (PLN, może być ujemny)</label>
                      <input style={{ ...baseInp, MozAppearance: "textfield" }} type="number" step="any"
                        placeholder="z XTB → zysk/strata"
                        value={brokerPnl} onChange={e => setBrokerPnl(e.target.value)}
                        onFocus={focusInp} onBlur={blurInp}
                        onKeyDown={e => e.key === "Enter" && submit()} />
                    </div>
                  </div>
                  {val > 0 && (
                    <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                      <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Podsumowanie</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zainwestowano (wyliczone)</div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(invested)}</div>
                          <div style={{ fontSize: 10, color: "#4a5a6e", marginTop: 1 }}>wartość − P&L</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#5a7a9e" }}>Aktualna wartość</div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(val)}</div>
                          {pnl !== 0 && (
                            <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: pnl >= 0 ? "#00c896" : "#f05060" }}>
                              {pnl >= 0 ? "+" : ""}{fmtPLN(pnl)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* Notatka */}
        {selected && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelSt}>Notatka (opcjonalnie)</label>
            <input style={baseInp} placeholder="np. XTB, zakup marzec 2024..."
              value={note} onChange={e => setNote(e.target.value)}
              onFocus={focusInp} onBlur={blurInp} />
          </div>
        )}

        {/* Przyciski */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={submit}
            onMouseEnter={() => setHovSave(true)} onMouseLeave={() => setHovSave(false)}
            disabled={!canSave}
            style={{
              flex: 1, padding: "10px 16px", borderRadius: 8,
              border: "2px solid #e8e040",
              background: hovSave && canSave ? "#e8e04012" : "transparent",
              color: "#e8e040", fontWeight: 700, fontSize: 13,
              cursor: canSave ? "pointer" : "not-allowed",
              fontFamily: "'Sora', sans-serif", transition: "all .2s",
              opacity: canSave ? 1 : 0.4,
            }}>
            {isEdit ? "Zapisz zmiany" : "Dodaj do portfela"}
          </button>
          {isEdit && (
            <button onClick={() => { onDelete(stock.id); onClose(); }}
              onMouseEnter={() => setHovDel(true)} onMouseLeave={() => setHovDel(false)}
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

// ─── Podkomponent: podsumowanie zakupu ────────────────────────────────────────
function Summary({ paid, current, pnl, pnlPct, sub }) {
  return (
    <div style={{ background: "#0f1a27", border: "1px solid #1a3a20", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#5a7a9e", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Podsumowanie</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#5a7a9e" }}>Zapłacono łącznie</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e8f0f8", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(paid)}</div>
          {sub && <div style={{ fontSize: 11, color: "#4a5a6e" }}>{sub}</div>}
        </div>
        {current !== null && (
          <div>
            <div style={{ fontSize: 11, color: "#5a7a9e" }}>Aktualna wartość</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>{fmtPLN(current)}</div>
            {pnl !== null && (
              <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: pnl >= 0 ? "#00c896" : "#f05060" }}>
                {pnl >= 0 ? "+" : ""}{fmtPLN(pnl)} ({pnlPct >= 0 ? "+" : ""}{pnlPct?.toFixed(1)}%)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Logo spółki/ETF ─────────────────────────────────────────────────────────
function StockLogo({ symbol, size = 28 }) {
  const [err, setErr] = useState(false);
  const url = `https://s.yimg.com/lb/brands/150x150/${symbol.toLowerCase()}.png`;
  if (err) {
    const colors = ["#e8e040","#00c896","#3b9eff","#ff5ecb","#f0a030"];
    const color = colors[symbol.charCodeAt(0) % colors.length];
    return (
      <div style={{ width: size, height: size, borderRadius: 6, background: color + "22", border: `1px solid ${color}60`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: size * 0.35, fontWeight: 700, color, fontFamily: "'DM Mono', monospace" }}>{symbol.slice(0,2)}</span>
      </div>
    );
  }
  return <img src={url} onError={() => setErr(true)} style={{ width: size, height: size, borderRadius: 6, objectFit: "contain", background: "#1a2535", flexShrink: 0 }} alt={symbol} />;
}

// ─── Wiersz akcji/ETF na liście ───────────────────────────────────────────────
export function StockRow({ stock, stockPrices, onClick }) {
  const [hov, setHov] = useState(false);
  const color = "#e8e040";

  const priceData = stockPrices[stock.stockSymbol];
  const currentValuePLN = priceData
    ? stock.stockQuantity * priceData.pricePLN
    : stock.value;

  // Koszt zakupu — obsługa wszystkich trybów
  let paidPLN = stock.stockPaidPLN || 0;
  if (!paidPLN && stock.stockTranches?.length) {
    paidPLN = stock.stockTranches.reduce((s, t) => s + (t.totalPLN || 0), 0);
  }
  if (!paidPLN) paidPLN = stock.value;

  const pnlPLN = currentValuePLN - paidPLN;
  const pnlPct = paidPLN > 0 ? (pnlPLN / paidPLN) * 100 : 0;
  const hasLivePrice = !!priceData;

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
        background: hov ? "#111720" : "#161d28", borderRadius: 12, marginBottom: 8,
        border: `1px solid ${hov ? color + "50" : "#1e2a38"}`, cursor: "pointer", transition: "all .15s"
      }}>
      <StockLogo symbol={stock.stockSymbol} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e040", fontFamily: "'DM Mono', monospace" }}>
              {stock.stockSymbol}
            </span>
            <span style={{ fontSize: 12, color: "#e8f0f8", marginLeft: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {stock.stockName || stock.name}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#e8f0f8", flexShrink: 0 }}>
            {fmtPLN(currentValuePLN)}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4a5a6e", whiteSpace: "nowrap" }}>
            {stock.stockQuantity > 0 && `${stock.stockQuantity} szt.`}
            {priceData && (
              <span style={{ marginLeft: 4, color: "#5a6a7e" }}>
                @ {priceData.priceOrig.toFixed(2)} {stock.stockCurrency}
              </span>
            )}
            {!hasLivePrice && (
              <span style={{ color: "#3a4a5e", marginLeft: 4 }}>• odświeżanie...</span>
            )}
          </div>
          {hasLivePrice && (
            <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: "nowrap", color: pnlPLN >= 0 ? "#00c896" : "#f05060" }}>
              {pnlPLN >= 0 ? "+" : ""}{fmtPLN(pnlPLN)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}